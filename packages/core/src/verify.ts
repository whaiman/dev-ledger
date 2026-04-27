import type { DevEvent } from "./types.js";
import { hashLogChain, sha256 } from "./hash.js";

export interface VerifyResult {
  valid: boolean;
  reason?: string;
  firstHash?: string;
  lastHash?: string;
  integrityHash: string;
  summaryHash?: string;
}

export function computeSummaryHash(events: DevEvent[]): string {
  // Hash the concatenation of all individual event hashes to create a stable summary
  const content = events.map(e => e.hash).join(",");
  return sha256(content);
}

export function verifyChain(events: DevEvent[], filters?: { project?: string; range?: string }): VerifyResult {
  // Optional filtering for proof (used even if chain is broken)
  let targetedEvents = events;
  if (filters?.project) {
    targetedEvents = targetedEvents.filter(e => e.project === filters.project);
  }
  
  if (filters?.range) {
    targetedEvents = targetedEvents.filter(e => {
      const date = new Date(e.timestamp);
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      return `${y}-${m}` === filters.range;
    });
  }

  const summaryHash = computeSummaryHash(targetedEvents);

  if (events.length === 0) {
    return {
      valid: true,
      integrityHash: hashLogChain([]),
      summaryHash
    };
  }

  // Basic chain verification
  for (let i = 1; i < events.length; i++) {
    if (events[i].prevHash !== events[i - 1].hash) {
      return {
        valid: false,
        reason: `Broken chain at index ${i}`,
        firstHash: events[0].hash,
        lastHash: events[events.length - 1].hash,
        integrityHash: hashLogChain(events),
        summaryHash
      };
    }
  }

  return {
    valid: true,
    firstHash: events[0].hash,
    lastHash: events[events.length - 1].hash,
    integrityHash: hashLogChain(events),
    summaryHash
  };
}