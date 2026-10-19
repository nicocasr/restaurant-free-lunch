import {
  MAX_PARALLEL_CALLS,
  callsForNextRound,
  recordRound,
  recordSale,
  startPurchase,
} from '../../src/domain/purchase-progress';

const half = () => 0.5;

describe('startPurchase', () => {
  it('starts with nothing bought and no failed attempts', () => {
    expect(startPurchase(4)).toEqual({ requested: 4, bought: 0, failedAttempts: 0 });
  });

  it.each([0, -2, 1.5])('rejects a requested quantity of %p', (requested) => {
    expect(() => startPurchase(requested)).toThrow(RangeError);
  });
});

describe('recordSale', () => {
  it('completes the purchase when the market sells exactly what is missing', () => {
    expect(recordSale(startPurchase(3), 3, half)).toEqual({
      progress: { requested: 3, bought: 3, failedAttempts: 0 },
      next: { action: 'complete' },
    });
  });

  it('completes the purchase when the market sells more than asked (leftovers)', () => {
    expect(recordSale(startPurchase(1), 4, half)).toEqual({
      progress: { requested: 1, bought: 4, failedAttempts: 0 },
      next: { action: 'complete' },
    });
  });

  it('buys again right away when the market sells only part of what is missing', () => {
    const first = recordSale(startPurchase(196), 2, half);
    const second = recordSale(first.progress, 3, half);

    expect(first.next).toEqual({ action: 'buy' });
    expect(second).toEqual({
      progress: { requested: 196, bought: 5, failedAttempts: 0 },
      next: { action: 'buy' },
    });
  });

  it('waits before retrying when the market has nothing to sell', () => {
    expect(recordSale(startPurchase(3), 0, half)).toEqual({
      progress: { requested: 3, bought: 0, failedAttempts: 1 },
      next: { action: 'wait', delayMs: 500 }, // half of the 1 s base of attempt 1
    });
  });

  it('waits longer after each consecutive time the market has nothing to sell', () => {
    let progress = startPurchase(3);
    const delays: number[] = [];

    for (let i = 0; i < 6; i++) {
      const result = recordSale(progress, 0, half);
      progress = result.progress;
      if (result.next.action === 'wait') {
        delays.push(result.next.delayMs);
      }
    }

    expect(delays).toEqual([500, 1_000, 2_000, 4_000, 5_000, 5_000]);
  });

  it('resets the backoff after a successful sale', () => {
    let progress = startPurchase(5);
    progress = recordSale(progress, 0, half).progress;
    progress = recordSale(progress, 0, half).progress;
    progress = recordSale(progress, 0, half).progress;

    const afterSale = recordSale(progress, 2, half);
    const nextZero = recordSale(afterSale.progress, 0, half);

    expect(afterSale.progress.failedAttempts).toBe(0);
    expect(nextZero.next).toEqual({ action: 'wait', delayMs: 500 });
  });

  it('uses Math.random for the jitter when no random source is given', () => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(0.25);

    expect(recordSale(startPurchase(3), 0).next).toEqual({ action: 'wait', delayMs: 250 });

    random.mockRestore();
  });

  it.each([-1, 1.5, Number.NaN])('rejects a sold quantity of %p', (quantitySold) => {
    expect(() => recordSale(startPurchase(3), quantitySold, half)).toThrow(RangeError);
  });
});

describe('callsForNextRound', () => {
  it('calls the market several times at once while much is missing, up to a limit', () => {
    expect(MAX_PARALLEL_CALLS).toBe(5);
    expect(callsForNextRound(startPurchase(48))).toBe(5);
  });

  it('calls fewer times as the purchase gets close, so leftovers stay small', () => {
    // The market sells about 2.5 units per call: 4 missing units need about 2 calls
    expect(callsForNextRound({ requested: 10, bought: 6, failedAttempts: 0 })).toBe(2);
    expect(callsForNextRound({ requested: 10, bought: 9, failedAttempts: 0 })).toBe(1);
  });

  it('makes no call once the purchase is covered', () => {
    expect(callsForNextRound({ requested: 3, bought: 4, failedAttempts: 0 })).toBe(0);
  });
});

describe('recordRound', () => {
  it('adds up every sale of the round', () => {
    expect(recordRound(startPurchase(10), [2, 0, 3], half)).toEqual({
      progress: { requested: 10, bought: 5, failedAttempts: 0 },
      next: { action: 'buy' },
    });
  });

  it('completes the purchase when the round covers it', () => {
    expect(recordRound(startPurchase(4), [3, 2], half).next).toEqual({ action: 'complete' });
  });

  it('waits only when no call of the round sold anything', () => {
    expect(recordRound(startPurchase(4), [0, 0, 0], half)).toEqual({
      progress: { requested: 4, bought: 0, failedAttempts: 1 },
      next: { action: 'wait', delayMs: 500 },
    });
  });

  it('rejects a round without answers or with an invalid quantity', () => {
    expect(() => recordRound(startPurchase(4), [], half)).toThrow(RangeError);
    expect(() => recordRound(startPurchase(4), [2, -1], half)).toThrow(RangeError);
  });
});
