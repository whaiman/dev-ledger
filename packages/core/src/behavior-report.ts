/**
 * behavior-report.ts
 * Форматирует BehaviorProfile в читаемый отчёт.
 * Размещение: packages/core/src/behavior-report.ts
 *
 * Использование в CLI:
 *   import { formatBehaviorReport } from "./behavior-report";
 *   console.log(formatBehaviorReport(profile, events));
 */

import {
  BehaviorProfile,
} from "./behavior-analyzer.js";

// ---------------------------------------------------------------------------
// Markdown-отчёт (для README inject)
// ---------------------------------------------------------------------------

export function formatBehaviorMarkdown(
  profile: BehaviorProfile,
  projectName: string,
): string {
  if (profile.insufficientData) {
    return `#### Integrity & Behavior\n\n- **Humanity Score**: N/A *(insufficient data)*\n`;
  }

  const { humanityScore, signals, metrics } = profile;

  const scoreBar = buildScoreBar(humanityScore);
  const verdict = humanityVerdict(humanityScore);

  const lines: string[] = [
    `#### Integrity & Behavior (Local AI Analysis)`,
    ``,
    `| Metric | Value | Interpretation |`,
    `|--------|-------|----------------|`,
    `| **Human-like editing score** | ${humanityScore}% | ${verdict} |`,
    `| Incremental typing ratio | ${pct(metrics.incrementalityRatio)} | ${incrementalityNote(metrics.incrementalityRatio)} |`,
    `| Edit rhythm entropy | ${metrics.gapEntropy.toFixed(2)} / 1.00 | ${entropyNote(metrics.gapEntropy)} |`,
    `| Burstiness index | ${metrics.burstinessIndex.toFixed(2)} | ${burstinessNote(metrics.burstinessIndex)} |`,
    `| Edit size variation (CV) | ${metrics.editSizeCV.toFixed(2)} | ${cvNote(metrics.editSizeCV)} |`,
    `| Mean edit size | ${metrics.meanEditSizeChars.toFixed(0)} chars | - |`,
    ``,
  ];

  // Сигналы
  const pasteSignals = signals.filter((s) => s.kind === "large_paste");
  const burstSignals = signals.filter((s) => s.kind === "burst_sequence");
  const otherSignals = signals.filter(
    (s) => s.kind !== "large_paste" && s.kind !== "burst_sequence",
  );

  lines.push(`**Behavior Signals**`);
  lines.push(``);

  if (signals.length === 0) {
    lines.push(`- ✅ No abnormal patterns detected`);
  } else {
    for (const s of pasteSignals) {
      lines.push(
        `- ⚠ Large paste events: **${countFromDescription(s.description)}** ` +
          `*(confidence: ${pct(s.confidence)})*`,
      );
    }
    for (const s of burstSignals) {
      lines.push(
        `- ⚠ Burst sequences detected ` +
          `*(confidence: ${pct(s.confidence)})*`,
      );
    }
    for (const s of otherSignals) {
      lines.push(`- ⚠ ${s.description}`);
    }
  }

  lines.push(``);
  lines.push(
    `> Analysis is fully local and deterministic. Same logs → same result.`,
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Plain-text (для devledger report в терминале)
// ---------------------------------------------------------------------------

export function formatBehaviorTerminal(profile: BehaviorProfile): string {
  if (profile.insufficientData) {
    return [
      `  Behavior Analysis`,
      `  ─────────────────────────────────`,
      `  Insufficient data (< 5 edit events)`,
    ].join("\n");
  }

  const { humanityScore, signals, metrics } = profile;

  const pasteCount = signals
    .filter((s) => s.kind === "large_paste")
    .reduce((sum, s) => sum + countFromDescription(s.description), 0);

  const burstCount = signals.filter((s) => s.kind === "burst_sequence").length;

  const lines = [
    `  Behavior Analysis (Local Statistical AI)`,
    `  ─────────────────────────────────────────`,
    `  Human-like editing score : ${humanityScore}%  ${humanityBar(humanityScore)}`,
    `  Incremental typing ratio : ${pct(metrics.incrementalityRatio)}`,
    `  Large paste events       : ${pasteCount}`,
    `  Burst sequences          : ${burstCount}`,
    `  Edit rhythm entropy      : ${metrics.gapEntropy.toFixed(2)} / 1.00`,
    `  Burstiness index         : ${metrics.burstinessIndex.toFixed(3)}  (human: 0.15–0.55)`,
    `  Edit size CV             : ${metrics.editSizeCV.toFixed(2)}`,
    `  Samples analyzed         : ${metrics.sampleCount}`,
  ];

  if (signals.length > 0) {
    lines.push(``, `  Signals:`);
    for (const s of signals) {
      const conf = Math.round(s.confidence * 100);
      lines.push(`    ⚠  [${conf}%] ${s.description}`);
    }
  } else {
    lines.push(``, `  ✅  No abnormal patterns detected`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// JSON (для devledger stats)
// ---------------------------------------------------------------------------

export interface BehaviorReportJSON {
  humanityScore: number;
  largePasteEvents: number;
  burstSequences: number;
  incrementalTypingRatio: number;
  editEntropyScore: number;
  burstinessIndex: number;
  editSizeCV: number;
  signals: Array<{
    kind: string;
    confidence: number;
    description: string;
  }>;
  insufficientData: boolean;
}

export function formatBehaviorJSON(
  profile: BehaviorProfile,
): BehaviorReportJSON {
  const pasteCount = profile.signals
    .filter((s) => s.kind === "large_paste")
    .reduce((sum, s) => sum + countFromDescription(s.description), 0);

  return {
    humanityScore: profile.humanityScore,
    largePasteEvents: pasteCount,
    burstSequences: profile.signals.filter((s) => s.kind === "burst_sequence")
      .length,
    incrementalTypingRatio: parseFloat(
      profile.metrics.incrementalityRatio.toFixed(3),
    ),
    editEntropyScore: parseFloat(profile.metrics.gapEntropy.toFixed(3)),
    burstinessIndex: parseFloat(profile.metrics.burstinessIndex.toFixed(3)),
    editSizeCV: parseFloat(profile.metrics.editSizeCV.toFixed(3)),
    signals: profile.signals.map((s) => ({
      kind: s.kind,
      confidence: parseFloat(s.confidence.toFixed(3)),
      description: s.description,
    })),
    insufficientData: profile.insufficientData,
  };
}

// ---------------------------------------------------------------------------
// Вспомогательные функции
// ---------------------------------------------------------------------------

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function humanityBar(score: number): string {
  const filled = Math.round(score / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

function buildScoreBar(score: number): string {
  return humanityBar(score);
}

function humanityVerdict(score: number): string {
  if (score >= 85) return "✅ Consistent with human activity";
  if (score >= 65) return "🔶 Mostly human, some automated patterns";
  if (score >= 45) return "⚠ Mixed - significant automated signals";
  return "🚫 Predominantly non-human editing patterns";
}

function incrementalityNote(ratio: number): string {
  if (ratio >= 0.7) return "Normal human typing pattern";
  if (ratio >= 0.4) return "Below average incrementality";
  return "Unusually low - bulk insertions likely";
}

function entropyNote(entropy: number): string {
  if (entropy >= 0.7) return "Rich temporal variety - human-like";
  if (entropy >= 0.4) return "Moderate rhythm variation";
  return "Low - suspiciously regular or sparse";
}

function burstinessNote(bi: number): string {
  if (bi >= 0.15 && bi <= 0.55) return "Within normal human range";
  if (bi < 0.15) return "Too regular - possible macro/bot";
  return "High burst pattern - bulk insertions";
}

function cvNote(cv: number): string {
  if (cv >= 0.8) return "High variation - mixed edit sizes (human)";
  if (cv >= 0.4) return "Moderate variation";
  return "Low - uniform block sizes (generated?)";
}

/** Вытащить количество событий из строки описания (хрупко, но для внутреннего использования ок) */
function countFromDescription(desc: string): number {
  const match = desc.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 1;
}
