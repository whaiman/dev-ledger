import type { DevEvent, DevStats } from "./types.js";
import { analyzeBehavior } from "./behaviorAnalyzer.js";

export function aggregate(events: DevEvent[], filterProject?: string): DevStats {
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

  // Initialize hours
  for (let h = 0; h < 24; h++) stats.byHour[h] = 0;

  // 1. Filter by latest reset per project
  const projectResets: Record<string, number> = {};
  for (let i = 0; i < events.length; i++) {
    if (events[i].type === "checkpoint" && events[i].label === "reset") {
      projectResets[events[i].project] = i;
    }
  }

  const filteredEvents = events.filter((e, i) => {
    if (filterProject && e.project !== filterProject) return false;
    const resetIdx = projectResets[e.project] ?? -1;
    return i > resetIdx;
  }).sort((a, b) => a.timestamp - b.timestamp);

  if (filteredEvents.length === 0) return stats;

  // Run behavior analysis (Local AI)
  stats.humanityScore = analyzeBehavior(filteredEvents);

  stats.eventCount = filteredEvents.length;
  stats.sessionCount = 1;

  const SESSION_THRESHOLD_MS = 5 * 60_000; // 5 minutes

  let lastEvent = filteredEvents[0];
  let burstCount = 0;

  for (let i = 1; i < filteredEvents.length; i++) {
    const current = filteredEvents[i];
    const gap = current.timestamp - lastEvent.timestamp;

    if (current.metadata?.is_large_paste) {
      const time = new Date(current.timestamp).toLocaleTimeString();
      stats.signals.push(`Large paste detected at ${time} in ${current.file || 'unknown'}`);
    }

    // 3.6 Behavior Analysis: Burst Editing Detection
    if (current.type === "file_edit" && lastEvent.type === "file_edit") {
      if (gap <= 2000) {
        burstCount++;
        if (burstCount === 50) {
          stats.signals.push(`Sustained burst editing detected (high-frequency pattern)`);
        }
      } else {
        burstCount = 0;
      }
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