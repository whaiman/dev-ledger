
import { createHash, randomUUID } from "node:crypto";
import type { EventInput, DevEvent } from "./types.js";

function stableStringify(input: Record<string, unknown>): string {
  return JSON.stringify(input, Object.keys(input).sort());
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function createEvent(input: EventInput, prevHash: string): DevEvent {
  const id = randomUUID();

  const payloadForHash = stableStringify({
    id,
    prevHash,
    timestamp: input.timestamp,
    type: input.type,
    project: input.project,
    file: input.file ?? "",
    language: input.language ?? "",
    durationMs: input.durationMs ?? 0,
    label: input.label ?? "",
    metadata: input.metadata ?? {}
  });

  const hash = sha256(payloadForHash);

  return {
    id,
    timestamp: input.timestamp,
    type: input.type,
    project: input.project,
    file: input.file,
    language: input.language,
    durationMs: input.durationMs,
    label: input.label,
    metadata: input.metadata,
    prevHash,
    hash
  };
}

export function hashLogChain(events: DevEvent[]): string {
  return sha256(events.map((e) => e.hash).join("|"));
}