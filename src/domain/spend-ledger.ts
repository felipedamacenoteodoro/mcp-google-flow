import { BudgetExceededError, InvalidInputError, SpendNotConfirmedError } from './errors.js';

/**
 * Credit budget for the lifetime of the server process.
 *
 * Flow prints the price of the next submit in its settings panel; that value is
 * charged when available. When it is not, the caller charges a conservative
 * estimate instead, so an unreadable price never means "free".
 */
export class SpendLedger {
  private spent = 0;

  constructor(
    readonly limit: number,
    readonly fallbackCostPerVariant: number,
  ) {
    for (const [name, value] of [
      ['limit', limit],
      ['fallbackCostPerVariant', fallbackCostPerVariant],
    ] as const) {
      if (!Number.isInteger(value) || value < 0) {
        throw new InvalidInputError(`${name} must be a non-negative integer.`);
      }
    }
  }

  get remaining(): number {
    return this.limit - this.spent;
  }

  /** Flow's price when known, otherwise the configured estimate per variant. */
  costOf(knownCost: number | null, variants: number): number {
    return knownCost ?? this.fallbackCostPerVariant * variants;
  }

  /** Throws unless the caller explicitly confirmed and the budget covers `credits`. */
  authorize(credits: number, confirmed: boolean): void {
    if (!confirmed) {
      throw new SpendNotConfirmedError(
        `This action spends about ${credits} Flow credit(s). Review the prepared state, then call again with confirm=true.`,
      );
    }
    if (credits > this.remaining) {
      throw new BudgetExceededError(
        `Needs ${credits} credit(s) but only ${this.remaining} of the ${this.limit}-credit session budget remain.`,
      );
    }
  }

  record(credits: number): void {
    this.spent += credits;
  }
}
