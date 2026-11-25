/**
 * Per-connection sliding 1-second message rate limiter.
 * Allows up to `maxPerSecond` messages in any 1000ms window and throttles ERROR(RATE_LIMITED) replies.
 */
export class ConnectionRateLimiter {
  private readonly maxPerSecond: number;
  private readonly timestamps: number[] = [];
  private head = 0;
  private lastErrorSentAt = 0;

  constructor(maxPerSecond = 120) {
    this.maxPerSecond = maxPerSecond;
  }

  check(nowMs: number): { allowed: boolean; shouldSendError: boolean } {
    const cutoff = nowMs - 1000;
    while (this.head < this.timestamps.length && this.timestamps[this.head] <= cutoff) {
      this.head += 1;
    }
    if (this.head > 256 && this.head * 2 >= this.timestamps.length) {
      this.timestamps.splice(0, this.head);
      this.head = 0;
    }

    const activeCount = this.timestamps.length - this.head;
    if (activeCount >= this.maxPerSecond) {
      const shouldSendError = nowMs - this.lastErrorSentAt >= 500;
      if (shouldSendError) {
        this.lastErrorSentAt = nowMs;
      }
      return { allowed: false, shouldSendError };
    }

    this.timestamps.push(nowMs);
    return { allowed: true, shouldSendError: false };
  }
}
