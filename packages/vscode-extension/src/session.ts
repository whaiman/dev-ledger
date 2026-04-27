export class SessionManager {
  private sessionStart: number | null = null;
  private lastEventTime = Date.now();
  private accumulatedIdle = 0;

  begin() {
    if (this.sessionStart === null) {
      this.sessionStart = Date.now();
    }
  }

  touch() {
    this.lastEventTime = Date.now();
  }

  addIdle(ms: number) {
    this.accumulatedIdle += ms;
  }

  shouldCloseSession(idleThreshold: number): boolean {
    return Date.now() - this.lastEventTime > idleThreshold;
  }

  closeSession() {
    if (this.sessionStart === null) return null;

    const duration = Date.now() - this.sessionStart;

    const result = {
      durationMs: Math.max(0, duration - this.accumulatedIdle),
      idleMs: this.accumulatedIdle,
      start: this.sessionStart,
      end: Date.now()
    };

    this.sessionStart = null;
    this.accumulatedIdle = 0;

    return result;
  }
}