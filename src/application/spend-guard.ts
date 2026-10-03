import { randomUUID } from 'node:crypto';
import { PreconditionFailedError, SpendNotConfirmedError } from '../domain/errors.js';
import type { SpendLedger } from '../domain/spend-ledger.js';
import type { Clock, Logger, RateLimiter } from './ports.js';

export interface Quote {
  readonly quoteId: string;
  readonly credits: number;
  readonly expiresInSeconds: number;
}

/** A paid request identified by what it would do, so a quote cannot be reused for something else. */
export interface Approval {
  readonly confirm: boolean;
  readonly quoteId?: string | undefined;
  /** Canonical description of the request (prompt, settings, attachments...). */
  readonly request: unknown;
}

export interface PaidOutcome<T> {
  readonly result: T;
  readonly creditsCharged: number;
}

const QUOTE_TTL_MS = 10 * 60_000;

/**
 * The single gate every credit-spending click goes through.
 *
 * Spending takes two calls. The first (confirm=false) prepares the request and
 * returns a quote bound to that exact request and price. The second must carry
 * confirm=true AND that quote id; a blind confirm, a quote for a different
 * request, an expired quote or a price that went up are all refused. Then come
 * the session budget, the hourly rate limit, the action and the ledger entry.
 */
export class SpendGuard {
  private readonly quotes = new Map<string, { fingerprint: string; credits: number; expiresAt: number }>();

  constructor(
    private readonly ledger: SpendLedger,
    private readonly limiter: RateLimiter,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  get remaining(): number {
    return this.ledger.remaining;
  }

  get limit(): number {
    return this.ledger.limit;
  }

  /** Price to charge: Flow's own label when shown, otherwise the conservative estimate. */
  priceOf(knownCost: number | null, variants = 1): number {
    return this.ledger.costOf(knownCost, variants);
  }

  quote(request: unknown, credits: number): Quote {
    this.dropExpired();
    const quoteId = randomUUID().slice(0, 8);
    this.quotes.set(quoteId, { fingerprint: fingerprint(request), credits, expiresAt: this.clock.now() + QUOTE_TTL_MS });
    return { quoteId, credits, expiresInSeconds: QUOTE_TTL_MS / 1000 };
  }

  /** Fails fast, before touching the UI, when a confirm carries no valid quote for this request. */
  verify(approval: Approval): void {
    this.checkQuote(0, approval, false);
  }

  /** Consumes the quote for `credits` and checks the budget, for work charged in several steps. */
  redeem(approval: Approval, credits: number): void {
    this.checkQuote(credits, approval, true);
    this.ledger.authorize(credits, true);
  }

  /** Budget, rate limit, action, ledger entry. Only for requests whose quote was already redeemed. */
  async charge<T>(what: string, credits: number, action: () => Promise<T>): Promise<PaidOutcome<T>> {
    if (credits === 0) return { result: await action(), creditsCharged: 0 };
    this.ledger.authorize(credits, true);
    this.limiter.take();
    const result = await action();
    this.ledger.record(credits);
    this.logger.info('paid action', { what, credits, remaining: this.ledger.remaining });
    return { result, creditsCharged: credits };
  }

  /**
   * Redeems the quote and charges in one step. A quote is always consumed when
   * given; only a zero-credit action with no confirmation (e.g. a free export)
   * runs without one.
   */
  async spend<T>(what: string, credits: number, approval: Approval, action: () => Promise<T>): Promise<PaidOutcome<T>> {
    if (credits > 0 || approval.confirm) this.checkQuote(credits, approval, true);
    return this.charge(what, credits, action);
  }

  private checkQuote(credits: number, approval: Approval, consume: boolean): void {
    if (!approval.confirm || !approval.quoteId) {
      throw new SpendNotConfirmedError(
        `This spends about ${credits} credit(s). Call with confirm=false to get a quote, review it, then call again with confirm=true and its quote_id.`,
      );
    }
    this.dropExpired();
    const quote = this.quotes.get(approval.quoteId);
    if (!quote) {
      throw new SpendNotConfirmedError('Unknown or expired quote_id. Prepare the request again with confirm=false.');
    }
    if (quote.fingerprint !== fingerprint(approval.request)) {
      throw new SpendNotConfirmedError('This quote_id was issued for a different request. Prepare this one with confirm=false.');
    }
    if (credits > quote.credits) {
      throw new PreconditionFailedError(`The price went up from ${quote.credits} to ${credits} credit(s). Prepare again to get a new quote.`);
    }
    if (consume) this.quotes.delete(approval.quoteId);
  }

  private dropExpired(): void {
    const now = this.clock.now();
    for (const [id, quote] of this.quotes) if (quote.expiresAt <= now) this.quotes.delete(id);
  }
}

/** Stable JSON: object keys sorted so the same request always yields the same fingerprint. */
function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}
