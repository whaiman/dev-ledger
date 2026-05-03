import * as vscode from "vscode";
import path from "node:path";
import {
  DevEventType,
  EventInput,
  createEvent,
  appendEvent,
  getDefaultLogPath,
  getLastHash,
  readEvents,
  aggregate,
} from "@devledger/core";
import { findProjectRoot } from "./project.js";

export interface TrackerOptions {
  logDir?: string;
  idleTimeoutMs?: number;
  idleCheckMs?: number;
  editThrottleMs?: number;
}

export class Tracker implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;
  private statusBarItem: vscode.StatusBarItem;

  private readonly logPath: string;
  private readonly idleTimeoutMs: number;
  private readonly idleCheckMs: number;
  private readonly editThrottleMs: number;

  private lastHash = "genesis";
  private isInitialized = false;
  private lastActivity = Date.now();
  private idle = false;

  private currentFile: string | undefined;
  private lastEditByFile = new Map<string, number>();

  // Serialise all emit calls through a single promise chain to prevent
  // race conditions on lastHash when multiple VS Code events fire concurrently.
  private emitQueue: Promise<void> = Promise.resolve();

  constructor(private readonly context: vscode.ExtensionContext, options: TrackerOptions = {}) {
    this.logPath = options.logDir ? path.join(options.logDir, "events.jsonl") : getDefaultLogPath();

    this.idleTimeoutMs = options.idleTimeoutMs ?? 2 * 60_000;
    this.idleCheckMs = options.idleCheckMs ?? 10_000;
    this.editThrottleMs = options.editThrottleMs ?? 1_000;

    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.text = "$(pulse) DevLedger";
    this.statusBarItem.tooltip = "DevLedger is active";
    this.statusBarItem.show();
    this.disposables.push(this.statusBarItem);

    this.updateStatusBar();
    const statusTimer = setInterval(() => this.updateStatusBar(), 60_000);
    this.disposables.push({ dispose: () => clearInterval(statusTimer) });
  }

  start(): void {
    this.lastActivity = Date.now();
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!editor) return;

        const file = editor.document.fileName;
        const language = editor.document.languageId;

        if (file !== this.currentFile) {
          const durationMs = this.markActivity();
          this.currentFile = file;
          this.emit("file_focus", editor.document, durationMs, language);
        } else {
          this.markActivity();
        }
      }),

      vscode.workspace.onDidChangeTextDocument((e) => {
        const doc = e.document;
        if (doc.isUntitled) return;

        const file = doc.fileName;
        const now = Date.now();
        const last = this.lastEditByFile.get(file) ?? 0;

        if (now - last < this.editThrottleMs) return;
        this.lastEditByFile.set(file, now);

        const durationMs = this.markActivity();

        let linesChanged = 0;
        let charsAdded = 0;
        let charsRemoved = 0;
        for (const change of e.contentChanges) {
          linesChanged += change.text.split("\n").length - 1;
          charsAdded += change.text.length;
          charsRemoved += change.rangeLength;
        }

        const metadata: Record<string, unknown> = {
          lines_changed: linesChanged,
          chars_added: charsAdded,
          chars_removed: charsRemoved,
        };

        if (linesChanged > 50 || charsAdded > 2000) {
          metadata.is_large_paste = true;
        }

        this.emit("file_edit", doc, durationMs, undefined, metadata);
      }),

      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.isUntitled) return;

        const durationMs = this.markActivity();
        this.emit("file_save", doc, durationMs);
      }),

      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.markActivity();
          if (this.idle) {
            this.idle = false;
            this.updateStatusBar();
            this.emitSystem("idle_end", undefined);
          }
        }
      })
    );

    this.timer = setInterval(() => {
      const idleFor = Date.now() - this.lastActivity;

      if (!this.idle && idleFor >= this.idleTimeoutMs) {
        this.idle = true;
        this.updateStatusBar();
        this.emitSystem("idle_start", idleFor);
      }
    }, this.idleCheckMs);

    this.context.subscriptions.push(this);
  }

  private async updateStatusBar(): Promise<void> {
    try {
      const events = await readEvents(this.logPath);
      const project = vscode.workspace.workspaceFolders?.[0]?.name;

      if (!project) return;

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const todayEvents = events.filter(
        (e) => e.project === project && e.timestamp >= todayStart.getTime()
      );
      const todayStats = aggregate(todayEvents, project);

      const totalMin = Math.floor(todayStats.totalMs / 60_000);
      const hours = Math.floor(totalMin / 60);
      const mins = totalMin % 60;
      const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

      if (this.idle) {
        this.statusBarItem.text = `$(circle-slash) ${timeStr} today`;
        this.statusBarItem.tooltip = `DevLedger: Idle - ${timeStr} coded today`;
      } else {
        this.statusBarItem.text = `$(pulse) ${timeStr} today`;
        this.statusBarItem.tooltip = `DevLedger: Active - ${timeStr} coded today`;
      }
    } catch {
      this.statusBarItem.text = "$(pulse) DevLedger";
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private markActivity(): number {
    const now = Date.now();
    const duration = now - this.lastActivity;
    this.lastActivity = now;
    return duration;
  }

  private async syncLastHash(): Promise<void> {
    if (this.isInitialized) return;
    this.lastHash = await getLastHash(this.logPath);
    this.isInitialized = true;
  }

  /**
   * Public-facing emit: enqueues the work so that concurrent VS Code events
   * are processed serially. This guarantees `lastHash` is always consistent
   * and the hash chain is never broken by parallel writes.
   */
  private emit(
    type: DevEventType,
    doc?: vscode.TextDocument,
    durationMs?: number,
    language?: string,
    metadata?: Record<string, unknown>
  ): void {
    this.emitQueue = this.emitQueue.then(() =>
      this._doEmit(type, doc, durationMs, language, metadata)
    );
  }

  private async _doEmit(
    type: DevEventType,
    doc?: vscode.TextDocument,
    durationMs?: number,
    language?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const absFile = doc?.isUntitled ? undefined : doc?.fileName;
    const projectRoot = absFile ? await findProjectRoot(absFile) : undefined;
    if (!projectRoot) return;

    const projectName = path.basename(projectRoot);
    let displayFile = absFile;

    if (absFile && projectRoot) {
      const parentDir = path.dirname(projectRoot);
      displayFile = path.relative(parentDir, absFile).replace(/\\/g, "/");
    }

    await this.syncLastHash();

    const input: EventInput = {
      timestamp: Date.now(),
      type,
      project: projectName,
      file: displayFile,
      language: language ?? doc?.languageId,
      durationMs,
      metadata,
    };

    const event = createEvent(input, this.lastHash);
    this.lastHash = event.hash;
    await appendEvent(event, this.logPath).catch((err) =>
      console.error("DevLedger emit error:", err)
    );
  }

  /**
   * System events (idle_start / idle_end) are also routed through the
   * same queue so they don't race with file events.
   */
  private emitSystem(type: "idle_start" | "idle_end", durationMs?: number): void {
    this.emitQueue = this.emitQueue.then(() => this._doEmitSystem(type, durationMs));
  }

  private async _doEmitSystem(
    type: "idle_start" | "idle_end",
    durationMs?: number
  ): Promise<void> {
    const project = await this.resolveProject(undefined);
    if (!project) return;

    await this.syncLastHash();

    const input: EventInput = {
      timestamp: Date.now(),
      type,
      project,
      durationMs,
    };

    const event = createEvent(input, this.lastHash);
    this.lastHash = event.hash;
    await appendEvent(event, this.logPath).catch((err) =>
      console.error("DevLedger emit error:", err)
    );
  }

  private async resolveProject(filePath: string | undefined): Promise<string | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;

    if (!filePath) {
      // Check if any workspace folder is initialized as a DevLedger project
      for (const folder of folders) {
        const root = await findProjectRoot(path.join(folder.uri.fsPath, "dummy.ts"));
        if (root) return path.basename(root);
      }
      return undefined;
    }

    const projectRoot = await findProjectRoot(filePath);
    if (projectRoot) return path.basename(projectRoot);
    return undefined;
  }
}