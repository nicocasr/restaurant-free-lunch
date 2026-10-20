/** A source of numbers in [0, 1), like Math.random. Injected so tests are deterministic. */
export type RandomSource = () => number;

/** The longest wait between two calls to the farmers market (PLANNING §2). */
export const MAX_RETRY_DELAY_MS = 10_000;

const FIRST_RETRY_DELAY_MS = 1_000;

/**
 * Exponential backoff with full jitter (PLANNING §3.3): the base time doubles on each attempt
 * up to the cap, and the actual wait is a random share of it, so retries of different
 * ingredients spread out instead of hitting the market all at once.
 */
export function retryDelay(attempt: number, random: RandomSource = Math.random): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError(`Attempts start at 1, got ${String(attempt)}`);
  }
  const share = random();
  if (!(share >= 0 && share < 1)) {
    throw new RangeError(`Random source must return a number in [0, 1), got ${String(share)}`);
  }
  // 2 ** attempt overflows to Infinity after many attempts; Math.min keeps it at the cap.
  const base = Math.min(MAX_RETRY_DELAY_MS, FIRST_RETRY_DELAY_MS * 2 ** (attempt - 1));
  return share * base;
}
