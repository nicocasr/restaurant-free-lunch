import { randomUUID } from 'node:crypto';

import { createEvent } from '@alegra-lunch/contracts';

import { trackOrder } from '../../src/application/track-order';
import { InMemoryOrders } from '../support/in-memory-orders';

const workdayId = randomUUID();
const context = { correlationId: randomUUID() };

async function setup() {
  const orders = new InMemoryOrders();
  const orderId = randomUUID();
  await orders.saveNewOrders([{ orderId, batchId: randomUUID(), workdayId, status: 'PLACED' }]);
  const track = trackOrder({ orders });
  const order = () => orders.allOrders.find((each) => each.orderId === orderId);
  return { orderId, track, order };
}

const events = {
  requested: (orderId: string) =>
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
    ),
  waiting: (orderId: string) =>
    createEvent(
      'OrderWaitingIngredients',
      { orderId, workdayId, missing: [{ ingredient: 'onion', quantity: 1 }] },
      context,
    ),
  reserved: (orderId: string) =>
    createEvent('IngredientsReserved', { orderId, workdayId }, context),
  delivered: (orderId: string) =>
    createEvent('OrderDelivered', { orderId, workdayId, recipeId: 'ajiaco' }, context),
};

describe('trackOrder', () => {
  it('records the recipe when the kitchen picks it', async () => {
    const { orderId, track, order } = await setup();

    await track(events.requested(orderId));

    expect(order()).toMatchObject({
      status: 'COOKING_REQUESTED',
      recipeId: 'ajiaco',
      recipeName: 'Ajiaco santafereño',
    });
  });

  it('records what a waiting order lacks and since when, for the dashboard', async () => {
    const { orderId, track, order } = await setup();
    const waiting = events.waiting(orderId);

    await track(events.requested(orderId));
    await track(waiting);

    expect(order()).toMatchObject({
      status: 'WAITING_INGREDIENTS',
      missing: [{ ingredient: 'onion', quantity: 1 }],
      waitingSince: waiting.occurredAt,
    });
  });

  it('follows the order until it is delivered', async () => {
    const { orderId, track, order } = await setup();

    await track(events.requested(orderId));
    await track(events.reserved(orderId));
    expect(order()?.status).toBe('PREPARING');

    await track(events.delivered(orderId));
    expect(order()?.status).toBe('DELIVERED');
  });

  it('never moves an order back when an event arrives late or twice', async () => {
    const { orderId, track, order } = await setup();

    await track(events.delivered(orderId));
    await track(events.reserved(orderId));
    await track(events.delivered(orderId));

    expect(order()?.status).toBe('DELIVERED');
  });

  it('keeps the recipe even when it arrives after a later status', async () => {
    // A single standard queue does not guarantee the order of the events
    const { orderId, track, order } = await setup();

    await track(events.reserved(orderId));
    await track(events.requested(orderId));

    expect(order()).toMatchObject({ status: 'PREPARING', recipeId: 'ajiaco' });
  });

  it('ignores a late notice of waiting for an order that is already being prepared', async () => {
    const { orderId, track, order } = await setup();

    await track(events.reserved(orderId));
    await track(events.waiting(orderId));

    expect(order()?.status).toBe('PREPARING');
    expect(order()?.missing).toBeUndefined();
  });

  it('ignores the events that do not move an order', async () => {
    const { orderId, track, order } = await setup();

    await track(
      createEvent(
        'StockShortage',
        { shortageId: randomUUID(), workdayId, ingredient: 'onion', quantity: 3 },
        context,
      ),
    );

    expect(order()).toEqual({
      orderId,
      batchId: expect.any(String) as string,
      workdayId,
      status: 'PLACED',
    });
  });
});
