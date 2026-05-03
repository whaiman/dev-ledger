import type { DevEvent, DevStats } from "./types.js";
import { analyzeBehavior, extractEditSamples } from "./behavior-analyzer.js";
import { minimatch } from "minimatch";

export function aggregate(events: DevEvent[], filterProject?: string, ignorePatterns: string[] = []): DevStats {
  const stats: DevStats = {
    totalMs: 0,
    idleMs: 0,
    byProject: {},
    byLanguage: {},
    byHour: {},
    eventCount: 0,
    sessionCount: 0,
    signals: [],
    humanityScore: { score: 1, reasons: [] }
  };

  if (events.length === 0) return stats;

  for (let h = 0; h < 24; h++) stats.byHour[h] = 0;

  // 1. Find latest reset per project
  const projectResets: Record<string, number> = {};
  for (let i = 0; i < events.length; i++) {
    if (events[i].type === "checkpoint" && events[i].label === "reset") {
      projectResets[events[i].project] = i;
    }
  }

  const filteredEvents = events.filter((e, i) => {
    if (filterProject && e.project !== filterProject) return false;
    const resetIdx = projectResets[e.project] ?? -1;
    if (i <= resetIdx) return false;
    if (e.file && ignorePatterns.length > 0 && ignorePatterns.some(p => minimatch(e.file!, p))) return false;
    return true;
  }).sort((a, b) => a.timestamp - b.timestamp);

  if (filteredEvents.length === 0) return stats;

  // 2. Behavior analysis
  const editSamples = extractEditSamples(filteredEvents);
  const profile = analyzeBehavior(editSamples);
  stats.humanityScore = {
    score: profile.humanityScore / 100,
    reasons: profile.signals.map(s => s.description),
  };
  stats.signals.push(...profile.signals.map(s => s.description));

  stats.eventCount = filteredEvents.length;
  stats.sessionCount = 1;

  const SESSION_THRESHOLD_MS = 5 * 60_000;

  let lastEvent = filteredEvents[0];

  for (let i = 1; i < filteredEvents.length; i++) {
    const current = filteredEvents[i];
    const gap = current.timestamp - lastEvent.timestamp;

    if (current.metadata?.is_large_paste) {
      const time = new Date(current.timestamp).toLocaleTimeString();
      stats.signals.push(`Large paste detected at ${time} in ${current.file || "unknown"}`);
    }

    if (gap > SESSION_THRESHOLD_MS) {
      stats.sessionCount++;
    } else {
      if (current.type === "idle_start") {
        stats.idleMs += current.durationMs ?? 0;
      } else if (lastEvent.type !== "idle_start") {
        stats.totalMs += gap;

        const project = current.project;
        stats.byProject[project] = (stats.byProject[project] ?? 0) + gap;

        const lang = current.language || lastEvent.language;
        if (lang) {
          stats.byLanguage[lang] = (stats.byLanguage[lang] ?? 0) + gap;
        }

        const hour = new Date(current.timestamp).getHours();
        stats.byHour[hour] = (stats.byHour[hour] ?? 0) + gap;
      }
    }

    lastEvent = current;
  }

  return stats;
}