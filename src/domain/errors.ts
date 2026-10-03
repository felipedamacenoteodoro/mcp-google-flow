/**
 * Every failure the agent can act on has a stable `code`. Anything that is not a
 * DomainError is treated as an internal fault and never leaks details outward.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidInputError extends DomainError {
  readonly code = 'INVALID_INPUT';
}

export class SpendNotConfirmedError extends DomainError {
  readonly code = 'SPEND_NOT_CONFIRMED';
}

export class BudgetExceededError extends DomainError {
  readonly code = 'BUDGET_EXCEEDED';
}

export class RateLimitedError extends DomainError {
  readonly code = 'RATE_LIMITED';

  constructor(readonly retryAfterMs: number) {
    super(`Too many paid actions in a short window. Retry in ${Math.ceil(retryAfterMs / 1000)}s.`);
  }
}

export class PreconditionFailedError extends DomainError {
  readonly code = 'PRECONDITION_FAILED';
}

export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
}

export class FlowUnavailableError extends DomainError {
  readonly code = 'FLOW_UNAVAILABLE';
}

export class TimeoutError extends DomainError {
  readonly code = 'TIMEOUT';
}
