export type DevEventType =
  | "file_focus"
  | "file_edit"
  | "file_save"
  | "idle_start"
  | "idle_end"
  | "checkpoint";

export interface DevEvent {
  id: string;
  timestamp: number;
  type: DevEventType;
  project: string;
  file?: string;
  language?: string;
  durationMs?: number;
  label?: string;
  metadata?: Record<string, any>;
  prevHash: string;
  hash: string;
}

export interface EventInput {
  timestamp: number;
  type: DevEventType;
  project: string;
  file?: string;
  language?: string;
  durationMs?: number;
  label?: string;
  metadata?: Record<string, any>;
}

export interface DevStats {
  totalMs: number;
  idleMs: number;
  byProject: Record<string, number>;
  byLanguage: Record<string, number>;
  byHour: Record<number, number>; // 0-23 hours
  eventCount: number;
  sessionCount: number;
  signals: string[];
  humanityScore: {
    score: number;
    reasons: string[];
  };
}