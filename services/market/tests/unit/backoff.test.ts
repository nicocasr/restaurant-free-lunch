import { MAX_RETRY_DELAY_MS, retryDelay } from '../../src/domain/backoff';

/** Just below 1: the longest wait full jitter can produce for an attempt. */
const ALMOST_ONE = 0.999999;

describe('retryDelay', () => {
  it('caps every wait at 10 seconds', () => {
    expect(MAX_RETRY_DELAY_MS).toBe(10_000);
  });

  it.each([
    [1, 1_000],
    [2, 2_000],
    [3, 4_000],
    [4, 8_000],
    [5, 10_000],
    [6, 10_000],
  ])('doubles the longest wait on attempt %i up to the cap (%i ms)', (attempt, base) => {
    const delay = retryDelay(attempt, () => ALMOST_ONE);

    expect(delay).toBeLessThan(base);
    expect(delay).toBeGreaterThan(base * 0.999);
  });

  it('waits a random share of the base time (full jitter)', () => {
    expect(retryDelay(3, () => 0.5)).toBe(2_000);
    expect(retryDelay(3, () => 0.25)).toBe(1_000);
  });

  it('can retry right away when the random share is 0', () => {
    expect(retryDelay(4, () => 0)).toBe(0);
  });

  it('stays at the cap after many attempts, since retries go on indefinitely', () => {
    expect(retryDelay(10_000, () => ALMOST_ONE)).toBeLessThan(MAX_RETRY_DELAY_MS);
    expect(Number.isFinite(retryDelay(10_000, () => ALMOST_ONE))).toBe(true);
  });

  it('uses Math.random when no random source is given', () => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(0.5);

    expect(retryDelay(1)).toBe(500);

    random.mockRestore();
  });

  it.each([0, -1, 1.5])('rejects attempt %p (attempts start at 1)', (attempt) => {
    expect(() => retryDelay(attempt, () => 0.5)).toThrow(RangeError);
  });

  it.each([-0.1, 1, Number.NaN])('rejects a random source that returns %p', (value) => {
    expect(() => retryDelay(1, () => value)).toThrow(RangeError);
  });
});
