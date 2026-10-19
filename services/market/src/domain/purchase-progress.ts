import { retryDelay, type RandomSource } from './backoff';

/** How far a purchase for one shortage has gone. */
export interface PurchaseProgress {
  requested: number;
  bought: number;
  /** Consecutive calls in which the market had nothing to sell. */
  failedAttempts: number;
}

export type NextStep =
  { action: 'complete' } | { action: 'buy' } | { action: 'wait'; delayMs: number };

export function startPurchase(requested: number): PurchaseProgress {
  if (!Number.isInteger(requested) || requested < 1) {
    throw new RangeError(`A purchase needs a positive whole quantity, got ${String(requested)}`);
  }
  return { requested, bought: 0, failedAttempts: 0 };
}

/** Calls to the farmers market at the same time, at most (PLANNING §3.5). */
export const MAX_PARALLEL_CALLS = 5;

/** What the market sold per call in the tests of PLANNING §3.5 (1 to 4 units). */
const EXPECTED_UNITS_PER_CALL = 2.5;

/**
 * How many calls the next round makes at once: one by one, a large purchase takes a call of
 * ~0.3 s per 2 or 3 units. Fewer calls as the purchase gets close keep leftovers small.
 */
export function callsForNextRound(progress: PurchaseProgress): number {
  const missing = progress.requested - progress.bought;
  if (missing <= 0) {
    return 0;
  }
  return Math.min(MAX_PARALLEL_CALLS, Math.ceil(missing / EXPECTED_UNITS_PER_CALL));
}

/**
 * Applies the answers of one round of calls (PLANNING §3.5). The market decides how much it
 * sells: a purchase completes once it covers what was requested, and the extra units are
 * leftovers for the warehouse. Any sale resets the backoff, since the market has stock again;
 * only a round where no call sold anything waits before the next one.
 */
export function recordRound(
  progress: PurchaseProgress,
  answers: readonly number[],
  random?: RandomSource,
): { progress: PurchaseProgress; next: NextStep } {
  if (answers.length === 0) {
    throw new RangeError('A round has at least one answer of the market');
  }
  for (const quantitySold of answers) {
    if (!Number.isInteger(quantitySold) || quantitySold < 0) {
      throw new RangeError(`The market sells a whole quantity >= 0, got ${String(quantitySold)}`);
    }
  }

  const sold = answers.reduce((total, quantity) => total + quantity, 0);
  if (sold === 0) {
    const failedAttempts = progress.failedAttempts + 1;
    return {
      progress: { ...progress, failedAttempts },
      next: { action: 'wait', delayMs: retryDelay(failedAttempts, random) },
    };
  }

  const bought = progress.bought + sold;
  return {
    progress: { ...progress, bought, failedAttempts: 0 },
    next: bought >= progress.requested ? { action: 'complete' } : { action: 'buy' },
  };
}

/** A round of a single call. */
export function recordSale(
  progress: PurchaseProgress,
  quantitySold: number,
  random?: RandomSource,
): { progress: PurchaseProgress; next: NextStep } {
  return recordRound(progress, [quantitySold], random);
}
