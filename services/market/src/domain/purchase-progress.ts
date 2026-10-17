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

/**
 * Applies one answer of the farmers market (PLANNING §3.5). The market decides how much it
 * sells: a purchase completes once it covers what was requested, and the extra units are
 * leftovers for the warehouse. A sale resets the backoff, since the market has stock again.
 */
export function recordSale(
  progress: PurchaseProgress,
  quantitySold: number,
  random?: RandomSource,
): { progress: PurchaseProgress; next: NextStep } {
  if (!Number.isInteger(quantitySold) || quantitySold < 0) {
    throw new RangeError(`The market sells a whole quantity >= 0, got ${String(quantitySold)}`);
  }

  if (quantitySold === 0) {
    const failedAttempts = progress.failedAttempts + 1;
    return {
      progress: { ...progress, failedAttempts },
      next: { action: 'wait', delayMs: retryDelay(failedAttempts, random) },
    };
  }

  const bought = progress.bought + quantitySold;
  return {
    progress: { ...progress, bought, failedAttempts: 0 },
    next: bought >= progress.requested ? { action: 'complete' } : { action: 'buy' },
  };
}
