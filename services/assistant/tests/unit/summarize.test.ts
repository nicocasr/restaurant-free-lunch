import { summarize, type Snapshot } from '../../src/domain/summarize';

const NOW = new Date('2026-10-20T15:00:00.000Z');

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    workdayId: 'workday-1',
    orders: [],
    inventory: [],
    purchases: [],
    recipes: [],
    ...overrides,
  };
}

describe('summarize', () => {
  it('counts the orders by status and the delivered dishes by recipe', () => {
    const summary = summarize(
      snapshot({
        orders: [
          { orderId: 'a', status: 'DELIVERED', recipeName: 'Ajiaco santafereño' },
          { orderId: 'b', status: 'DELIVERED', recipeName: 'Ajiaco santafereño' },
          { orderId: 'c', status: 'DELIVERED', recipeName: 'Changua con queso' },
          { orderId: 'd', status: 'PREPARING', recipeName: 'Picada bogotana' },
          { orderId: 'e', status: 'PLACED' },
        ],
      }),
      NOW,
    );

    expect(summary.orders.total).toBe(5);
    expect(summary.orders.byStatus).toEqual({ DELIVERED: 3, PREPARING: 1, PLACED: 1 });
    expect(summary.orders.deliveredByDish).toEqual({
      'Ajiaco santafereño': 2,
      'Changua con queso': 1,
    });
  });

  it('lists the waiting orders oldest first, with what they miss and for how long', () => {
    const summary = summarize(
      snapshot({
        orders: [
          {
            orderId: 'newer-order-id',
            status: 'WAITING_INGREDIENTS',
            recipeName: 'Changua con queso',
            missing: [{ ingredient: 'onion', quantity: 1 }],
            waitingSince: '2026-10-20T14:59:50.000Z',
          },
          {
            orderId: 'older-order-id',
            status: 'WAITING_INGREDIENTS',
            recipeName: 'Ajiaco santafereño',
            missing: [
              { ingredient: 'chicken', quantity: 1 },
              { ingredient: 'potato', quantity: 2 },
            ],
            waitingSince: '2026-10-20T14:58:00.000Z',
          },
        ],
      }),
      NOW,
    );

    expect(summary.orders.waiting).toEqual([
      {
        order: 'older-o',
        dish: 'Ajiaco santafereño',
        missing: 'chicken x1, potato x2',
        waitingSeconds: 120,
      },
      { order: 'newer-o', dish: 'Changua con queso', missing: 'onion x1', waitingSeconds: 10 },
    ]);
  });

  it('lists last a waiting order whose details have not arrived yet', () => {
    const summary = summarize(
      snapshot({
        orders: [
          { orderId: 'no-details-yet', status: 'WAITING_INGREDIENTS' },
          {
            orderId: 'known-order',
            status: 'WAITING_INGREDIENTS',
            missing: [{ ingredient: 'rice', quantity: 1 }],
            waitingSince: '2026-10-20T14:59:00.000Z',
          },
          { orderId: 'other-no-details', status: 'WAITING_INGREDIENTS' },
        ],
      }),
      NOW,
    );

    expect(summary.orders.waiting.map(({ order }) => order)).toEqual([
      'known-o',
      'no-deta',
      'other-n',
    ]);
    expect(summary.orders.waiting[1]).toEqual({
      order: 'no-deta',
      dish: undefined,
      missing: '',
      waitingSeconds: undefined,
    });
  });

  it('keeps only the 20 oldest waiting orders, but counts all of them', () => {
    const orders = Array.from({ length: 25 }, (_, index) => ({
      orderId: `order-${String(index).padStart(2, '0')}`,
      status: 'WAITING_INGREDIENTS' as const,
      waitingSince: new Date(NOW.getTime() - (index + 1) * 1_000).toISOString(),
    }));

    const summary = summarize(snapshot({ orders }), NOW);

    expect(summary.orders.waitingTotal).toBe(25);
    expect(summary.orders.waiting).toHaveLength(20);
    expect(summary.orders.waiting[0]?.waitingSeconds).toBe(25);
  });

  it('tells the stock, the units on their way and the need of the waiting orders', () => {
    const summary = summarize(
      snapshot({
        inventory: [{ ingredient: 'onion', stock: 0, waitingNeed: 6, inFlight: 4 }],
      }),
      NOW,
    );

    expect(summary.inventory).toEqual([
      { ingredient: 'onion', stock: 0, onItsWay: 4, neededByWaitingOrders: 6 },
    ]);
  });

  it('adds up the purchases by ingredient, the most bought first', () => {
    const summary = summarize(
      snapshot({
        purchases: [
          { ingredient: 'onion', quantity: 3 },
          { ingredient: 'potato', quantity: 2 },
          { ingredient: 'onion', quantity: 4 },
        ],
      }),
      NOW,
    );

    expect(summary.purchases).toEqual({
      purchases: 3,
      units: 9,
      byIngredient: [
        { ingredient: 'onion', purchases: 2, units: 7 },
        { ingredient: 'potato', purchases: 1, units: 2 },
      ],
    });
  });

  it('writes each recipe with its ingredients in one line', () => {
    const summary = summarize(
      snapshot({
        recipes: [
          {
            name: 'Changua con queso',
            ingredients: [
              { ingredient: 'cheese', quantity: 2 },
              { ingredient: 'onion', quantity: 1 },
            ],
          },
        ],
      }),
      NOW,
    );

    expect(summary.recipes).toEqual([
      { dish: 'Changua con queso', ingredients: 'cheese x2, onion x1' },
    ]);
  });

  it('describes a workday that has not started yet', () => {
    const summary = summarize(snapshot({ workdayId: undefined }), NOW);

    expect(summary.workdayId).toBeUndefined();
    expect(summary.orders.total).toBe(0);
    expect(summary.purchases.units).toBe(0);
  });
});
