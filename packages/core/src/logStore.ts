import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { DevEvent } from "./types.js";

export function getDefaultLogPath(): string {
  return path.join(os.homedir(), ".devledger", "events.jsonl");
}

export async function ensureLogDir(logPath = getDefaultLogPath()): Promise<void> {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
}

export async function appendEvent(event: DevEvent, logPath = getDefaultLogPath()): Promise<void> {
  await ensureLogDir(logPath);
  await fs.appendFile(logPath, `${JSON.stringify(event)}\n`, "utf8");
}

export async function readEvents(logPath = getDefaultLogPath()): Promise<DevEvent[]> {
  try {
    const raw = await fs.readFile(logPath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as DevEvent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function getLastHash(logPath = getDefaultLogPath()): Promise<string> {
  const events = await readEvents(logPath);
  if (events.length === 0) return "genesis";
  return events[events.length - 1].hash;
}