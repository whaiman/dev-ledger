/**
 * telemetry-capture.ts
 * Подключается к VS Code extension (extension.ts) и захватывает
 * edit-уровень телеметрии на каждое изменение документа.
 *
 * Размещение: packages/vscode-extension/src/telemetry-capture.ts
 *
 * Интеграция в extension.ts:
 *   import { registerTelemetryCapture } from "./telemetry-capture";
 *   registerTelemetryCapture(context, logger);
 */

import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Типы событий
// ---------------------------------------------------------------------------

/**
 * Единственный новый тип события в логе.
 * Хранится в том же JSONL файле через существующий Logger.
 */
export interface EditTelemetryEvent {
  type: "edit_telemetry";
  timestamp: number;

  project: string;
  file: string;
  language: string;

  lines_added: number;
  lines_removed: number;
  chars_added: number;
  chars_removed: number;

  /** Время между этой правкой и предыдущей в мс (0 если первая) */
  time_since_last_edit_ms: number;

  /**
   * Классификация типа изменения.
   *
   * "typing"      - маленькое и постепенное (≤ TYPING_THRESHOLD chars за раз)
   * "paste"       - большой блок появился быстро (статистически аномально)
   * "bulk_replace" - замена большого диапазона (chars_removed > 0 && chars_added большой)
   * "deletion"    - удаление без добавления
   */
  edit_kind: "typing" | "paste" | "bulk_replace" | "deletion";

  /**
   * Онлайн-оценка "буrstiness" в момент события.
   * Рассчитывается скользящим окном последних N правок.
   * Не требует пересчёта всего лога.
   */
  local_burst_score: number; // 0–1
}

// ---------------------------------------------------------------------------
// Интерфейс Logger (минимальный - подставь свой из packages/core)
// ---------------------------------------------------------------------------

export interface ILogger {
  log(event: EditTelemetryEvent): void;
  getProjectName(uri: vscode.Uri): string;
}

// ---------------------------------------------------------------------------
// Константы классификации
// ---------------------------------------------------------------------------

/**
 * Порог для определения "typing" по размеру.
 * Это НЕ триггер детекции - просто граница классификации события.
 * Детекция аномалий происходит в behavior-analyzer.ts статистически.
 */
const TYPING_MAX_CHARS = 5;

/** Количество последних правок для скользящего burst-окна */
const BURST_WINDOW = 20;

/** Нижняя граница "быстрого" гапа для burst-окна (мс) */
const BURST_GAP_THRESHOLD_MS = 300;

// ---------------------------------------------------------------------------
// Классификатор edit_kind
// ---------------------------------------------------------------------------

function classifyEditKind(
  charsAdded: number,
  charsRemoved: number,
  timeSinceLastMs: number
): EditTelemetryEvent["edit_kind"] {
  if (charsAdded === 0 && charsRemoved > 0) return "deletion";

  if (charsAdded > 0 && charsRemoved > TYPING_MAX_CHARS) return "bulk_replace";

  // Paste-эвристика: большой блок добавлен без паузы на набор
  // Логика: если chars_added > TYPING_MAX_CHARS И время с последней правки
  // меньше, чем нужно для набора такого объёма (≈ 60 WPM = 5 chars/300ms),
  // то это почти точно паста или автодополнение.
  //
  // Точная классификация не нужна здесь - behavior-analyzer сделает
  // статистическую верификацию. Это только первичный тег.
  if (charsAdded > TYPING_MAX_CHARS) {
    const minTypingTime = (charsAdded / 5) * 300; // мс для набора вручную
    if (timeSinceLastMs < minTypingTime * 0.3) return "paste";
  }

  return "typing";
}

// ---------------------------------------------------------------------------
// Скользящий burst-score (без хранения всего лога в памяти)
// ---------------------------------------------------------------------------

class BurstScoreWindow {
  private gaps: number[] = [];

  push(gapMs: number): number {
    this.gaps.push(gapMs);
    if (this.gaps.length > BURST_WINDOW) this.gaps.shift();
    return this.compute();
  }

  private compute(): number {
    if (this.gaps.length < 3) return 0;
    const fast = this.gaps.filter((g) => g < BURST_GAP_THRESHOLD_MS).length;
    return fast / this.gaps.length;
  }
}

// ---------------------------------------------------------------------------
// Основная функция регистрации
// ---------------------------------------------------------------------------

export function registerTelemetryCapture(
  context: vscode.ExtensionContext,
  logger: ILogger
): void {
  let lastEditTimestamp = 0;
  const burstWindow = new BurstScoreWindow();

  const disposable = vscode.workspace.onDidChangeTextDocument((event) => {
    const { document, contentChanges } = event;

    // Игнорируем служебные документы
    if (document.uri.scheme !== "file") return;
    if (contentChanges.length === 0) return;

    const now = Date.now();
    const timeSinceLast = lastEditTimestamp === 0 ? 0 : now - lastEditTimestamp;
    lastEditTimestamp = now;

    // Агрегируем все изменения одного события (VS Code может батчить)
    let totalCharsAdded = 0;
    let totalCharsRemoved = 0;
    let totalLinesAdded = 0;
    let totalLinesRemoved = 0;

    for (const change of contentChanges) {
      totalCharsAdded += change.text.length;
      totalCharsRemoved += change.rangeLength;

      // Считаем переносы строк в тексте изменения
      const newlines = (change.text.match(/\n/g) ?? []).length;
      totalLinesAdded += newlines;

      // Строки, которые были заменены (по диапазону)
      const removedLines =
        change.range.end.line - change.range.start.line;
      totalLinesRemoved += removedLines;
    }

    const editKind = classifyEditKind(
      totalCharsAdded,
      totalCharsRemoved,
      timeSinceLast
    );

    const localBurstScore = burstWindow.push(timeSinceLast);

    const telemetryEvent: EditTelemetryEvent = {
      type: "edit_telemetry",
      timestamp: now,

      project: logger.getProjectName(document.uri),
      file: document.uri.fsPath,
      language: document.languageId,

      lines_added: totalLinesAdded,
      lines_removed: totalLinesRemoved,
      chars_added: totalCharsAdded,
      chars_removed: totalCharsRemoved,

      time_since_last_edit_ms: timeSinceLast,
      edit_kind: editKind,
      local_burst_score: parseFloat(localBurstScore.toFixed(3)),
    };

    logger.log(telemetryEvent);
  });

  context.subscriptions.push(disposable);
}