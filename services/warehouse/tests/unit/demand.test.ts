import { evaluateDemand } from '../../src/domain/demand';

describe('evaluateDemand', () => {
  it('asks to buy what the waiting orders need when there is no stock and nothing in flight', () => {
    // 3 orders wait for 1 onion each
    expect(evaluateDemand({ waitingNeed: 3, inFlight: 0 }, 0)).toEqual({
      toPurchase: 3,
      demand: { waitingNeed: 3, inFlight: 3 },
    });
  });

  it('consolidates many waiting orders into a single purchase request', () => {
    // 200 orders wait for 1 onion each: one request for 200, not 200 requests
    expect(evaluateDemand({ waitingNeed: 200, inFlight: 0 }, 0).toPurchase).toBe(200);
  });

  it('subtracts the stock already available', () => {
    expect(evaluateDemand({ waitingNeed: 5, inFlight: 0 }, 2)).toEqual({
      toPurchase: 3,
      demand: { waitingNeed: 5, inFlight: 3 },
    });
  });

  it('requests nothing while a purchase of the ingredient is in flight, even if it falls short', () => {
    // 200 orders wait while the first purchase of 1 onion is on its way:
    // the rest is requested in one go once that purchase completes
    const demand = { waitingNeed: 200, inFlight: 1 };
    expect(evaluateDemand(demand, 0)).toEqual({ toPurchase: 0, demand });
  });

  it('buys nothing when the purchases in flight already cover the waiting orders', () => {
    const demand = { waitingNeed: 4, inFlight: 4 };
    expect(evaluateDemand(demand, 0)).toEqual({ toPurchase: 0, demand });
  });

  it('buys nothing when leftovers from a previous purchase cover the waiting orders', () => {
    // The market sold 4 onions for 3 waiting orders: 1 is left over
    const demand = { waitingNeed: 3, inFlight: 0 };
    expect(evaluateDemand(demand, 4)).toEqual({ toPurchase: 0, demand });
  });

  it('buys nothing when no order is waiting', () => {
    const demand = { waitingNeed: 0, inFlight: 0 };
    expect(evaluateDemand(demand, 0)).toEqual({ toPurchase: 0, demand });
  });
});
