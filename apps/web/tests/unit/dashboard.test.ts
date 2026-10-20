import { randomUUID } from 'node:crypto';

import { createEvent, type DomainEvent } from '@alegra-lunch/contracts';

import {
  dashboardReducer,
  delivered,
  orderHistory,
  emptyDashboard,
  inPreparation,
  type DashboardState,
} from '../../src/state/dashboard';

const workdayId = randomUUID();
const context = { correlationId: randomUUID() };

function loaded(): DashboardState {
  return dashboardReducer(emptyDashboard, {
    type: 'loaded',
    workdayId,
    orders: [],
    purchases: [],
  });
}

function apply(state: DashboardState, ...events: DomainEvent[]): DashboardState {
  return dashboardReducer(state, { type: 'events', events });
}

const placed = (orderId: string, batchId?: string) =>
  createEvent('OrderPlaced', { orderId, workdayId, ...(batchId && { batchId }) }, context);
const requested = (orderId: string) =>
  createEvent(
    'IngredientsRequested',
    {
      orderId,
      workdayId,
      recipeId: 'ajiaco',
      recipeName: 'Ajiaco santafereño',
      ingredients: [{ ingredient: 'onion', quantity: 1 }],
    },
    context,
  );
const waiting = (orderId: string) =>
  createEvent(
    'OrderWaitingIngredients',
    { orderId, workdayId, missing: [{ ingredient: 'onion', quantity: 1 }] },
    context,
  );
const reserved = (orderId: string) =>
  createEvent('IngredientsReserved', { orderId, workdayId }, context);
const deliveredEvent = (orderId: string) =>
  createEvent('OrderDelivered', { orderId, workdayId, recipeId: 'ajiaco' }, context);
const purchased = (quantity: number) =>
  createEvent(
    'IngredientPurchased',
    {
      purchaseId: randomUUID(),
      shortageId: randomUUID(),
      workdayId,
      ingredient: 'onion',
      quantity,
    },
    context,
  );

describe('dashboard state', () => {
  it('starts from what the APIs answered when the dashboard opens', () => {
    const orderId = randomUUID();
    const state = dashboardReducer(emptyDashboard, {
      type: 'loaded',
      workdayId,
      orders: [{ orderId, status: 'PREPARING', recipeName: 'Changua con queso' }],
      purchases: [],
    });

    expect(state.workdayId).toBe(workdayId);
    expect(inPreparation(state)).toEqual([
      expect.objectContaining({ orderId, status: 'PREPARING' }),
    ]);
  });

  it('follows an order from placed to delivered as its events arrive', () => {
    const orderId = randomUUID();

    let state = apply(loaded(), placed(orderId), requested(orderId));
    expect(inPreparation(state)).toEqual([
      expect.objectContaining({
        orderId,
        status: 'COOKING_REQUESTED',
        recipeName: 'Ajiaco santafereño',
      }),
    ]);

    state = apply(state, reserved(orderId), deliveredEvent(orderId));
    expect(inPreparation(state)).toEqual([]);
    expect(delivered(state)).toEqual([expect.objectContaining({ orderId, status: 'DELIVERED' })]);
  });

  it('shows what a waiting order lacks and since when', () => {
    const orderId = randomUUID();
    const wait = waiting(orderId);

    const state = apply(loaded(), placed(orderId), wait);

    expect(inPreparation(state)[0]).toMatchObject({
      status: 'WAITING_INGREDIENTS',
      missing: [{ ingredient: 'onion', quantity: 1 }],
      waitingSince: wait.occurredAt,
    });
  });

  it('never moves an order back when a batch brings its events out of order', () => {
    const orderId = randomUUID();

    const state = apply(loaded(), placed(orderId), deliveredEvent(orderId), reserved(orderId));

    expect(delivered(state)).toHaveLength(1);
  });

  it('applies each event once, even if it arrives in two batches', () => {
    const purchase = purchased(3);

    const state = apply(apply(loaded(), purchase), purchase);

    expect(state.purchases).toHaveLength(1);
  });

  it('adds every purchase at the farmers market to the history', () => {
    const state = apply(loaded(), purchased(3), purchased(1));

    expect(state.purchases.map(({ quantity }) => quantity)).toEqual([3, 1]);
  });

  it('asks to reload the inventory when an event changes it, and only then', () => {
    const orderId = randomUUID();
    const quiet = apply(loaded(), placed(orderId));
    expect(quiet.inventoryOutdated).toBe(false);

    const changed = apply(quiet, reserved(orderId));
    expect(changed.inventoryOutdated).toBe(true);

    const refreshed = dashboardReducer(changed, { type: 'inventoryReloaded' });
    expect(refreshed.inventoryOutdated).toBe(false);
    expect(apply(refreshed, purchased(2)).inventoryOutdated).toBe(true);
  });

  it('starts a clean board when a new workday begins', () => {
    const next = randomUUID();
    const state = apply(
      apply(loaded(), placed(randomUUID()), purchased(2)),
      createEvent('WorkdayStarted', { workdayId: next }, context),
    );

    expect(state.workdayId).toBe(next);
    expect(inPreparation(state)).toEqual([]);
    expect(state.purchases).toEqual([]);
    expect(state.inventoryOutdated).toBe(true);
  });

  it('leaves the board as it is for a purchase request, which changes no order or stock', () => {
    const before = loaded();
    const shortage = createEvent(
      'StockShortage',
      { shortageId: randomUUID(), workdayId, ingredient: 'onion', quantity: 2 },
      context,
    );

    const after = apply(before, shortage);

    expect(after.orders).toEqual(before.orders);
    expect(after.inventoryOutdated).toBe(false);
  });

  it('ignores events of another workday', () => {
    const other = createEvent(
      'OrderPlaced',
      { orderId: randomUUID(), workdayId: randomUUID() },
      context,
    );

    expect(inPreparation(apply(loaded(), other))).toEqual([]);
  });

  it('lists the orders in preparation oldest first and the delivered ones newest first', () => {
    const [first, second] = [randomUUID(), randomUUID()];

    const state = apply(
      loaded(),
      placed(first),
      placed(second),
      deliveredEvent(first),
      deliveredEvent(second),
    );

    expect(delivered(state).map(({ orderId }) => orderId)).toEqual([second, first]);
  });

  it('has one row per order the manager placed, the latest first, with its progress', () => {
    const [first, second] = [randomUUID(), randomUUID()];
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];

    const state = apply(
      loaded(),
      placed(a, first),
      placed(b, first),
      placed(c, second),
      requested(a),
      deliveredEvent(a),
    );

    expect(orderHistory(state)).toEqual([
      expect.objectContaining({ batchId: second, dishes: 1, delivered: 0, tookMs: undefined }),
      expect.objectContaining({
        batchId: first,
        dishes: 2,
        delivered: 1,
        served: [{ recipeName: 'Ajiaco santafereño', count: 1 }],
      }),
    ]);
  });

  it('sorts the orders by the time they were placed, whatever order the API answers in', () => {
    // Orders are spread over partitions, so the API does not return them by time.
    const at = (time: string) => ({
      orderId: randomUUID(),
      status: 'DELIVERED' as const,
      batchId: time,
      placedAt: `2026-10-19T${time}.000Z`,
    });

    const state = dashboardReducer(emptyDashboard, {
      type: 'loaded',
      workdayId,
      orders: [at('19:30:18'), at('20:21:34'), at('19:30:13')],
      purchases: [],
    });

    expect(orderHistory(state).map(({ batchId }) => batchId)).toEqual([
      '20:21:34',
      '19:30:18',
      '19:30:13',
    ]);
  });

  it('counts the dishes served per recipe, the most served first', () => {
    const batch = randomUUID();
    const orders = Array.from({ length: 3 }, (_, index) => ({
      orderId: randomUUID(),
      status: 'DELIVERED' as const,
      batchId: batch,
      recipeName: index === 0 ? 'Changua con queso' : 'Ajiaco santafereño',
    }));

    const state = dashboardReducer(emptyDashboard, {
      type: 'loaded',
      workdayId,
      orders,
      purchases: [],
    });

    expect(orderHistory(state)[0]?.served).toEqual([
      { recipeName: 'Ajiaco santafereño', count: 2 },
      { recipeName: 'Changua con queso', count: 1 },
    ]);
  });

  it('tells how long a completed order took, from placing it to its last delivery', () => {
    const batchId = randomUUID();
    const state = dashboardReducer(emptyDashboard, {
      type: 'loaded',
      workdayId,
      orders: [
        {
          orderId: randomUUID(),
          status: 'DELIVERED',
          batchId,
          placedAt: '2026-10-22T12:00:00.000Z',
          deliveredAt: '2026-10-22T12:00:20.000Z',
        },
        {
          orderId: randomUUID(),
          status: 'DELIVERED',
          batchId,
          placedAt: '2026-10-22T12:00:00.000Z',
          deliveredAt: '2026-10-22T12:00:38.000Z',
        },
      ],
      purchases: [],
    });

    expect(orderHistory(state)).toEqual([
      expect.objectContaining({ placedAt: '2026-10-22T12:00:00.000Z', tookMs: 38_000 }),
    ]);
  });

  it('remembers when each dish was placed from its event', () => {
    const orderId = randomUUID();
    const event = placed(orderId, randomUUID());

    expect(orderHistory(apply(loaded(), event))[0]?.placedAt).toBe(event.occurredAt);
  });
});
