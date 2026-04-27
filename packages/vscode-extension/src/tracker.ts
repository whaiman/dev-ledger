import * as vscode from "vscode";
import path from "node:path";
import { DevEventType, EventInput, createEvent, appendEvent, getDefaultLogPath, getLastHash } from "@devledger/core";
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

  constructor(private readonly context: vscode.ExtensionContext, options: TrackerOptions = {}) {
    this.logPath = options.logDir ? path.join(options.logDir, "events.jsonl") : getDefaultLogPath();

    this.idleTimeoutMs = options.idleTimeoutMs ?? 2 * 60_000;
    this.idleCheckMs = options.idleCheckMs ?? 10_000;
    this.editThrottleMs = options.editThrottleMs ?? 1_000;

    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.text = "$(pulse) DevLedger: Tracking";
    this.statusBarItem.tooltip = "DevLedger is active and tracking coding activity";
    this.statusBarItem.show();
    this.disposables.push(this.statusBarItem);
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

        // 3.6 Behavior Analysis: Large Paste Detection
        let linesChanged = 0;
        let charsChanged = 0;
        for (const change of e.contentChanges) {
          linesChanged += change.text.split("\n").length - 1;
          charsChanged += change.text.length;
        }

        const metadata: Record<string, any> = {
          lines_changed: linesChanged,
          chars_changed: charsChanged,
        };

        if (linesChanged > 50 || charsChanged > 2000) {
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
            this.statusBarItem.text = "$(pulse) DevLedger: Tracking";
            this.emitSystem("idle_end", undefined);
          }
        }
      })
    );

    this.timer = setInterval(() => {
      const idleFor = Date.now() - this.lastActivity;

      if (!this.idle && idleFor >= this.idleTimeoutMs) {
        this.idle = true;
        this.statusBarItem.text = "$(CircleSlash) DevLedger: Idle";
        this.emitSystem("idle_start", idleFor);
      }
    }, this.idleCheckMs);

    this.context.subscriptions.push(this);
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

  private async emit(
    type: DevEventType,
    doc?: vscode.TextDocument,
    durationMs?: number,
    language?: string,
    metadata?: Record<string, any>
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
    await appendEvent(event, this.logPath).catch(err => console.error("DevLedger emit error:", err));
  }

  private async emitSystem(type: "idle_start" | "idle_end", durationMs?: number): Promise<void> {
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
    await appendEvent(event, this.logPath).catch(err => console.error("DevLedger emit error:", err));
  }

  private async resolveProject(filePath: string | undefined): Promise<string | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;

    if (!filePath) {
      // Check if any workspace folder is initialized
      for (const folder of folders) {
        const root = await findProjectRoot(path.join(folder.uri.fsPath, "dummy.ts"));
        if (root) return path.basename(root);
      }
      return undefined;
    }

    const projectRoot = await findProjectRoot(filePath);
    if (projectRoot) {
      return path.basename(projectRoot);
    }

    return undefined;
  }
}