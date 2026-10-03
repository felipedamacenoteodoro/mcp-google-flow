import type { Clock, RateLimiter } from '../../application/ports.js';
import { RateLimitedError } from '../../domain/errors.js';

/** At most `max` paid actions in any `windowMs`. Protects the account from bursts. */
export class SlidingWindowLimiter implements RateLimiter {
  private readonly stamps: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly clock: Clock,
  ) {}

  take(): void {
    const now = this.clock.now();
    while (this.stamps.length > 0 && now - this.stamps[0]! >= this.windowMs) {
      this.stamps.shift();
    }
    if (this.stamps.length >= this.max) {
      throw new RateLimitedError(this.stamps[0]! + this.windowMs - now);
    }
    this.stamps.push(now);
  }
}
