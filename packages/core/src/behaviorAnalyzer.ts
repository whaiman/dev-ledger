import type { DevEvent } from "./types.js";

export interface HumanityScore {
  score: number; // 0 to 1, where 1 is definitely human
  reasons: string[];
}

export function analyzeBehavior(events: DevEvent[]): HumanityScore {
  let score = 1.0;
  const reasons: string[] = [];

  if (events.length < 5) return { score: 1, reasons: ["Insufficient data for analysis"] };

  // 1. Check for "Instant Massive Edits"
  const massiveEdits = events.filter(e => e.metadata?.is_large_paste);
  if (massiveEdits.length > 0) {
    const penalty = Math.min(0.2 * massiveEdits.length, 0.5);
    score -= penalty;
    reasons.push(`${massiveEdits.length} massive code block(s) detected (potential AI/Copy-paste)`);
  }

  // 2. Velocity Variance (Human typing has jitter)
  // We look at the gaps between consecutive edits
  const editGaps: number[] = [];
  for (let i = 1; i < events.length; i++) {
    if (events[i].type === "file_edit" && events[i-1].type === "file_edit") {
      editGaps.push(events[i].timestamp - events[i-1].timestamp);
    }
  }

  if (editGaps.length > 10) {
    const avgGap = editGaps.reduce((a, b) => a + b, 0) / editGaps.length;
    const variance = editGaps.reduce((a, b) => a + Math.pow(b - avgGap, 2), 0) / editGaps.length;
    const stdDev = Math.sqrt(variance);

    // If standard deviation is extremely low, it means the edits are too mechanical (bot-like)
    if (stdDev < 50) { 
      score -= 0.3;
      reasons.push("Extremely low timing variance (mechanical patterns detected)");
    }
  }

  // 3. Incrementality check
  const totalEdits = events.filter(e => e.type === "file_edit").length;
  const saves = events.filter(e => e.type === "file_save").length;
  
  if (totalEdits > 0 && saves > 0) {
    const editPerSave = totalEdits / saves;
    if (editPerSave < 1.2) {
      score -= 0.1;
      reasons.push("Low edit-to-save ratio (potential bulk modifications)");
    }
  }

  return { 
    score: Math.max(0, score), 
    reasons: reasons.length > 0 ? reasons : ["Behavioral patterns consistent with human activity"] 
  };
}
