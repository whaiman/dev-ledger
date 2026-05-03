/**
 * DevLedger - Statistical Behavior Analyzer
 *
 * Replaces all hardcoded thresholds (burstCount === 50, gap <= 2000, etc.)
 * with statistical measures derived from the actual data distribution.
 *
 * Core principle: A threshold should emerge from the data, not be invented by a developer.
 *
 * Algorithms used:
 *  1. Shannon Entropy  - measures temporal randomness of edit rhythm
 *  2. Coefficient of Variation (CV) - detects paste-like size uniformity
 *  3. Z-score outlier detection - flags individual anomalous events
 *  4. Incrementality Ratio - % of small, incremental edits
 *  5. Burstiness Index (BI) - based on inter-event time statistics
 *  6. Weighted Composite Score - final humanity score [0–100]
 */

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/**
 * Minimal edit sample expected from the event log.
 * Compatible with both the current `file_edit` events and the planned
 * `EditTelemetryEvent` (richer telemetry layer described in concept doc).
 */
export interface EditSample {
  timestamp: number;         // Unix ms
  charsAdded: number;
  charsRemoved: number;
  linesAdded?: number;
  linesRemoved?: number;
  editKind?: "typing" | "paste" | "bulk_replace" | "unknown";
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type SignalKind =
  | "large_paste"         // single event with anomalously large size
  | "burst_sequence"      // tight cluster of edits (statistical, not counted)
  | "uniform_cadence"     // suspiciously regular timing (bot/macro)
  | "low_incrementality"  // very few small edits - bulk generation
  | "low_entropy_rhythm"  // temporal pattern is too regular
  | "normal";

export interface BehaviorSignal {
  kind: SignalKind;
  confidence: number;         // 0–1
  description: string;
  affectedIndices?: number[]; // indices in the input array that triggered this
}

export interface BehaviorMetrics {
  /** Average inter-edit gap in ms */
  meanGapMs: number;
  /** Standard deviation of inter-edit gaps */
  stdGapMs: number;
  /**
   * Burstiness Index: (std - mean) / (std + mean)
   * Range [-1, 1]. Humans ≈ 0.2–0.6. Bots/pastes → -1 (too regular) or 1 (single burst).
   */
  burstinessIndex: number;
  /**
   * Shannon entropy of the inter-edit gap distribution (binned).
   * High entropy = irregular, human-like. Low entropy = mechanical.
   */
  gapEntropy: number;
  /**
   * Fraction of edits that are "small" (≤ SMALL_EDIT_CHARS chars total).
   * Humans typically have incrementality > 0.6.
   */
  incrementalityRatio: number;
  /**
   * Coefficient of Variation of edit sizes.
   * High CV = mixed sizes (human). Low CV = uniform blocks (paste/generated).
   */
  editSizeCV: number;
  /** Mean edit size in characters */
  meanEditSizeChars: number;
  /** Number of samples analyzed */
  sampleCount: number;
}

export interface BehaviorProfile {
  /** 0–100. Higher = more human-like. */
  humanityScore: number;
  signals: BehaviorSignal[];
  metrics: BehaviorMetrics;
  /** True when there is not enough data to make a confident assessment. */
  insufficientData: boolean;
}

// ---------------------------------------------------------------------------
// Constants (tunable, but NOT arbitrary thresholds for detection)
// These are only domain definitions, not trigger conditions.
// ---------------------------------------------------------------------------

/** Minimum samples needed for statistical significance */
const MIN_SAMPLES = 5;

/** A "small" edit is one where total char delta ≤ this value */
const SMALL_EDIT_CHARS = 10;

/** Gap histogram bins in ms: human typing spans these ranges */
const GAP_BINS_MS = [0, 150, 500, 1500, 5000, 15000, Infinity];

/** Z-score threshold for a single edit to be considered an outlier.
 *  3.5σ means only edits ~7× larger than the mean will be flagged -
 *  genuine pastes or large auto-generated blocks, not normal long lines. */
const ZSCORE_OUTLIER = 3.5;

/** Weights for the composite humanity score */
const WEIGHTS = {
  entropy: 0.25,
  incrementality: 0.25,
  burstiness: 0.20,
  editSizeCV: 0.20,
  pasteEvents: 0.10,
} as const;

// ---------------------------------------------------------------------------
// Math utilities
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[], mu?: number): number {
  if (values.length < 2) return 0;
  const m = mu ?? mean(values);
  const variance = values.reduce((a, v) => a + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Shannon entropy of a discrete distribution.
 * Input: array of counts (not probabilities).
 */
function shannonEntropy(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  return counts.reduce((H, c) => {
    if (c === 0) return H;
    const p = c / total;
    return H - p * Math.log2(p);
  }, 0);
}

/**
 * Normalise entropy to [0, 1] against the maximum possible entropy
 * for the given number of bins.
 */
function normalisedEntropy(counts: number[]): number {
  const H = shannonEntropy(counts);
  const maxH = Math.log2(counts.filter((c) => c > 0).length || 1);
  return maxH === 0 ? 1 : H / maxH;
}

/** Z-scores for an array of values */
function zScores(values: number[]): number[] {
  const m = mean(values);
  const s = stdDev(values, m);
  if (s === 0) return values.map(() => 0);
  return values.map((v) => (v - m) / s);
}

/** Clamp a value to [0, 1] */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

// ---------------------------------------------------------------------------
// Core analysis functions
// ---------------------------------------------------------------------------

/**
 * Compute inter-edit gaps in ms from an ordered list of samples.
 * Returns an array of length (samples.length - 1).
 */
function computeGaps(samples: EditSample[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    gaps.push(samples[i].timestamp - samples[i - 1].timestamp);
  }
  return gaps;
}

/**
 * Bin gaps into the defined histogram bins.
 */
function binGaps(gaps: number[]): number[] {
  const counts = new Array<number>(GAP_BINS_MS.length - 1).fill(0);
  for (const gap of gaps) {
    for (let b = 0; b < GAP_BINS_MS.length - 1; b++) {
      if (gap >= GAP_BINS_MS[b] && gap < GAP_BINS_MS[b + 1]) {
        counts[b]++;
        break;
      }
    }
  }
  return counts;
}

/**
 * Burstiness Index of Goh & Barabási (2008):
 *   BI = (σ - μ) / (σ + μ)
 *
 * Range [-1, 1]:
 *   BI → -1  perfectly regular (robotic, fixed interval)
 *   BI ≈  0  Poisson process (random, natural)
 *   BI → +1  extreme bursts (one huge event, then nothing)
 *
 * Human coders typically fall in the range [0.15, 0.55].
 * A large paste followed by silence pushes toward +1.
 * A macro running at fixed 500 ms intervals pushes toward -1.
 */
function burstinessIndex(gaps: number[]): number {
  if (gaps.length < 2) return 0;
  const m = mean(gaps);
  const s = stdDev(gaps, m);
  const denom = s + m;
  if (denom === 0) return 0;
  return (s - m) / denom;
}

/**
 * Convert Burstiness Index to a humanity-friendly score [0, 1].
 * The ideal human range is [0.15, 0.55]; we score highest at 0.35.
 */
function burstinessToScore(bi: number): number {
  // Distance from the centre of the human range (0.35)
  const humanCenter = 0.35;
  const humanWidth = 0.40; // ±0.20 around center is "normal"
  const dist = Math.abs(bi - humanCenter);
  return clamp01(1 - dist / humanWidth);
}

/**
 * Incrementality ratio: fraction of edits that are small (≤ SMALL_EDIT_CHARS).
 * Human coders iterate; generative tools insert blocks.
 */
function incrementalityRatio(samples: EditSample[]): number {
  if (samples.length === 0) return 1;
  const small = samples.filter(
    (s) => s.charsAdded + s.charsRemoved <= SMALL_EDIT_CHARS
  ).length;
  return small / samples.length;
}

/**
 * Coefficient of Variation (CV) of edit sizes.
 *   CV = σ / μ
 *
 * High CV (> 1.0) means very mixed edit sizes - typical of human coding.
 * Low CV (< 0.3) means all edits are the same size - suspicious uniformity.
 *
 * Returns a score [0, 1] where 1 is most human-like.
 */
function editSizeCVScore(samples: EditSample[]): { cv: number; score: number } {
  const sizes = samples.map((s) => s.charsAdded + s.charsRemoved);
  const m = mean(sizes);
  const s = stdDev(sizes, m);
  const cv = m === 0 ? 0 : s / m;
  // Score peaks at CV ≈ 1.5 (typical human), drops for very low or very high
  const score = clamp01(Math.min(cv / 1.5, 1.5 / Math.max(cv, 0.1)) * 0.9);
  return { cv, score };
}

/**
 * Detect individual paste events using Z-score on edit sizes.
 * Instead of "if charsAdded > 200 then flag", we ask:
 * "Is this edit more than ZSCORE_OUTLIER standard deviations above the mean?"
 *
 * This adapts to the developer's actual editing style.
 */
function detectPasteOutliers(
  samples: EditSample[]
): { indices: number[]; confidences: number[] } {
  if (samples.length < MIN_SAMPLES) return { indices: [], confidences: [] };

  const sizes = samples.map((s) => s.charsAdded + s.charsRemoved);
  const zs = zScores(sizes);

  const indices: number[] = [];
  const confidences: number[] = [];

  zs.forEach((z, i) => {
    if (z > ZSCORE_OUTLIER) {
      // Confidence scales with how far above the threshold this is
      const confidence = clamp01((z - ZSCORE_OUTLIER) / ZSCORE_OUTLIER);
      indices.push(i);
      confidences.push(confidence);
    }
  });

  return { indices, confidences };
}

/**
 * Detect burst sequences using gap Z-scores rather than a hardcoded count.
 *
 * OLD: if (burstCount === 50) { ... }  ← arbitrary, brittle
 * NEW: find contiguous runs where gap z-score < -ZSCORE_OUTLIER (very short gaps)
 *
 * A "burst" is a sequence of ≥ 3 consecutive edits with anomalously short gaps.
 */
function detectBurstSequences(
  samples: EditSample[],
  gaps: number[]
): { runs: number[][]; confidence: number } {
  if (gaps.length < MIN_SAMPLES) return { runs: [], confidence: 0 };

  const zs = zScores(gaps);
  const isBurst = zs.map((z) => z < -ZSCORE_OUTLIER);

  const runs: number[][] = [];
  let currentRun: number[] = [];

  for (let i = 0; i < isBurst.length; i++) {
    if (isBurst[i]) {
      // Gap i is between sample i and sample i+1
      if (currentRun.length === 0) currentRun.push(i); // start of gap
      currentRun.push(i + 1); // end of gap
    } else {
      if (currentRun.length >= 3) runs.push([...new Set(currentRun)]);
      currentRun = [];
    }
  }
  if (currentRun.length >= 3) runs.push([...new Set(currentRun)]);

  const totalBurstSamples = runs.reduce((a, r) => a + r.length, 0);
  const confidence = clamp01(totalBurstSamples / samples.length);

  return { runs, confidence };
}

/**
 * Detect suspiciously uniform cadence (e.g., a macro firing every 500 ms).
 * Uses the CV of inter-edit gaps: low CV = very regular timing.
 */
function detectUniformCadence(
  gaps: number[]
): { detected: boolean; confidence: number } {
  if (gaps.length < MIN_SAMPLES) return { detected: false, confidence: 0 };
  const m = mean(gaps);
  const s = stdDev(gaps, m);
  const cv = m === 0 ? 0 : s / m;
  // CV < 0.15 means gaps vary by less than 15% of their mean - very suspicious
  const detected = cv < 0.15;
  const confidence = detected ? clamp01(1 - cv / 0.15) : 0;
  return { detected, confidence };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyse a sequence of edit samples and return a complete behavioral profile.
 *
 * The samples must be sorted by timestamp (ascending).
 * The analyzer is deterministic: same input → same output.
 */
export function analyzeBehavior(samples: EditSample[]): BehaviorProfile {
  // --- Insufficient data fast-path ---
  if (samples.length < MIN_SAMPLES) {
    return {
      humanityScore: 100,
      signals: [],
      metrics: {
        meanGapMs: 0,
        stdGapMs: 0,
        burstinessIndex: 0,
        gapEntropy: 1,
        incrementalityRatio: 1,
        editSizeCV: 1,
        meanEditSizeChars: 0,
        sampleCount: samples.length,
      },
      insufficientData: true,
    };
  }

  // --- Compute base statistics ---
  const gaps = computeGaps(samples);
  const gapBins = binGaps(gaps);

  const meanGap = mean(gaps);
  const stdGap = stdDev(gaps, meanGap);
  const bi = burstinessIndex(gaps);
  const entropy = normalisedEntropy(gapBins);
  const incRatio = incrementalityRatio(samples);
  const { cv: editCV, score: cvScore } = editSizeCVScore(samples);
  const meanSize = mean(samples.map((s) => s.charsAdded + s.charsRemoved));

  // --- Run detectors ---
  const { indices: pasteIndices, confidences: pasteConf } =
    detectPasteOutliers(samples);
  const { runs: burstRuns, confidence: burstConf } = detectBurstSequences(
    samples,
    gaps
  );
  const { detected: uniformDetected, confidence: uniformConf } =
    detectUniformCadence(gaps);

  // --- Build signals list ---
  const signals: BehaviorSignal[] = [];

  if (pasteIndices.length > 0) {
    const maxConf = Math.max(...pasteConf);
    signals.push({
      kind: "large_paste",
      confidence: maxConf,
      description: `${pasteIndices.length} edit(s) with anomalously large size (>${ZSCORE_OUTLIER}σ above mean of ${Math.round(meanSize)} chars)`,
      affectedIndices: pasteIndices,
    });
  }

  if (burstRuns.length > 0) {
    signals.push({
      kind: "burst_sequence",
      confidence: burstConf,
      description: `${burstRuns.length} burst sequence(s) detected: ${burstRuns.map((r) => `${r.length} consecutive edits`).join(", ")}`,
      affectedIndices: burstRuns.flat(),
    });
  }

  if (uniformDetected) {
    signals.push({
      kind: "uniform_cadence",
      confidence: uniformConf,
      description: `Edit timing is suspiciously regular (gap CV = ${editCV.toFixed(2)}, expected > 0.15 for human activity)`,
    });
  }

  if (incRatio < 0.3) {
    const confidence = clamp01(1 - incRatio / 0.3);
    signals.push({
      kind: "low_incrementality",
      confidence,
      description: `Only ${Math.round(incRatio * 100)}% of edits are small (≤${SMALL_EDIT_CHARS} chars); human coders typically exceed 60%`,
    });
  }

  if (entropy < 0.4) {
    const confidence = clamp01(1 - entropy / 0.4);
    signals.push({
      kind: "low_entropy_rhythm",
      confidence,
      description: `Edit rhythm entropy is low (${entropy.toFixed(2)}); temporal pattern is too regular for typical human activity`,
    });
  }

  // --- Compute humanity score ---
  //
  // Each dimension is normalised to [0, 1] where 1 = most human-like.
  // The final score is a weighted average, mapped to [0, 100].

  // Paste penalty is proportional to what fraction of edits were pastes,
  // weighted by confidence. 3 pastes in 2400 events ≈ 0.1% → negligible penalty.
  const pasteRatio = pasteIndices.length > 0
    ? (pasteIndices.length / samples.length) * mean(pasteConf)
    : 0;
  const pasteEventPenalty = clamp01(1 - pasteRatio * 5); // 5× amplifier so it still matters

  const dimensionScores = {
    entropy: clamp01(entropy * 1.2),            // boost: flow-state typing can be low-entropy
    incrementality: clamp01(incRatio / 0.4),    // 40%+ incremental = human (was 70%)
    burstiness: burstinessToScore(bi),
    editSizeCV: cvScore,
    pasteEvents: pasteEventPenalty,
  };

  const humanityScore = Math.round(
    100 *
      clamp01(
        Object.entries(WEIGHTS).reduce(
          (sum, [key, w]) => sum + w * dimensionScores[key as keyof typeof WEIGHTS],
          0
        )
      )
  );

  // --- Assemble metrics ---
  const metrics: BehaviorMetrics = {
    meanGapMs: Math.round(meanGap),
    stdGapMs: Math.round(stdGap),
    burstinessIndex: parseFloat(bi.toFixed(3)),
    gapEntropy: parseFloat(entropy.toFixed(3)),
    incrementalityRatio: parseFloat(incRatio.toFixed(3)),
    editSizeCV: parseFloat(editCV.toFixed(3)),
    meanEditSizeChars: parseFloat(meanSize.toFixed(1)),
    sampleCount: samples.length,
  };

  return {
    humanityScore,
    signals,
    metrics,
    insufficientData: false,
  };
}

// ---------------------------------------------------------------------------
// Adapter: convert raw DevLedger log events → EditSample[]
// ---------------------------------------------------------------------------

/**
 * Minimal interface matching DevLedger's existing log event structure.
 * Extend this as the telemetry layer is enriched.
 */
export interface RawLogEvent {
  type: string;
  timestamp: number;
  metadata?: {
    /** Set by tracker.ts for each individual contentChange */
    chars_added?: number;
    chars_removed?: number;
    lines_added?: number;
    lines_removed?: number;
    edit_kind?: "typing" | "paste" | "bulk_replace";
    lines_changed?: number;
    chars_changed?: number;
    is_large_paste?: boolean;
  };
}

/**
 * Extract EditSamples from raw log events.
 * Supports both the current tracker format ({ chars_added, chars_removed })
 * and the legacy format ({ chars_changed }).
 * Silently ignores non-edit events.
 */
export function extractEditSamples(events: any[]): EditSample[] {
  return events
    .filter((e) => e.type === "file_edit")
    .map((e) => {
      const m = e.metadata ?? {};

      // Prefer split fields; fall back to legacy chars_changed for old logs
      const charsAdded: number = m.chars_added ?? m.chars_changed ?? 0;
      const charsRemoved: number = m.chars_removed ?? 0;

      return {
        timestamp: e.timestamp,
        charsAdded,
        charsRemoved,
        linesAdded: m.lines_added,
        linesRemoved: m.lines_removed,
        editKind: m.edit_kind ?? "unknown",
      } satisfies EditSample;
    });
}