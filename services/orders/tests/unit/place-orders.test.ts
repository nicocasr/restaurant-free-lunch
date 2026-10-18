import { randomUUID } from 'node:crypto';

import { InMemoryPublisher } from '@alegra-lunch/testing';

import { placeOrders } from '../../src/application/place-orders';
import { InMemoryOrders } from '../support/in-memory-orders';

const workdayId = randomUUID();

function setup() {
  const orders = new InMemoryOrders();
  orders.activeWorkdayId = workdayId;
  const publisher = new InMemoryPublisher();
  return { orders, publisher, handle: placeOrders({ orders, publisher, maxQuantity: 1_000 }) };
}

describe('placeOrders', () => {
  describe('a new batch', () => {
    it('creates one order per dish, placed in the active workday', async () => {
      const { orders, handle } = setup();
      const idempotencyKey = randomUUID();

      const batch = await handle({ idempotencyKey, quantity: 3 });

      expect(batch.batchId).toBe(idempotencyKey);
      expect(batch.workdayId).toBe(workdayId);
      expect(batch.orderIds).toHaveLength(3);
      expect(new Set(batch.orderIds).size).toBe(3);
      expect(orders.allOrders).toEqual(
        batch.orderIds.map((orderId) => ({
          orderId,
          batchId: idempotencyKey,
          workdayId,
          status: 'PLACED',
        })),
      );
    });

    it('sends one OrderPlaced per dish to the kitchen, traced by its own order id', async () => {
      const { publisher, handle } = setup();

      const batch = await handle({ idempotencyKey: randomUUID(), quantity: 3 });

      expect(publisher.ofType('OrderPlaced')).toEqual(
        batch.orderIds.map((orderId) =>
          expect.objectContaining({ correlationId: orderId, payload: { orderId, workdayId } }),
        ),
      );
    });

    it('fails without creating anything when no workday is active', async () => {
      const { orders, publisher, handle } = setup();
      orders.activeWorkdayId = undefined;

      await expect(handle({ idempotencyKey: randomUUID(), quantity: 3 })).rejects.toThrow(
        /no active workday/i,
      );
      expect(orders.allOrders).toEqual([]);
      expect(publisher.events).toEqual([]);
    });
  });
});
