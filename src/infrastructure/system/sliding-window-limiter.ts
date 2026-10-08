import type { Clock, RateLimiter } from '../../application/ports.js';
import { RateLimitedError } from '../../domain/errors.js';

/**
 * Paces paid actions: at most `max` in any `windowMs`, and at least
 * `minIntervalMs` between two of them. Bursts are what most often trip
 * Flow's abuse protection, so a calm default pace protects the account.
 */
export class SlidingWindowLimiter implements RateLimiter {
  private readonly stamps: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly clock: Clock,
    private readonly minIntervalMs = 0,
  ) {}

  msUntilAvailable(): number {
    const now = this.clock.now();
    this.forgetOld(now);
    const last = this.stamps.at(-1);
    const spacing = last === undefined ? 0 : Math.max(0, last + this.minIntervalMs - now);
    const window = this.stamps.length >= this.max ? this.stamps[0]! + this.windowMs - now : 0;
    return Math.max(spacing, window);
  }

  take(): void {
    const wait = this.msUntilAvailable();
    if (wait > 0) throw new RateLimitedError(wait);
    this.stamps.push(this.clock.now());
  }

  private forgetOld(now: number): void {
    while (this.stamps.length > 0 && now - this.stamps[0]! >= this.windowMs) this.stamps.shift();
  }
}
