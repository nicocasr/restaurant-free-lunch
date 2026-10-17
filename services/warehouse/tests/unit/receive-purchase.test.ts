import { randomUUID } from 'node:crypto';

import { createEvent, type Ingredient, type IngredientQuantity } from '@alegra-lunch/contracts';
import { InMemoryPublisher } from '@alegra-lunch/testing';

import { receivePurchase } from '../../src/application/receive-purchase';
import { InMemoryWarehouse } from '../support/in-memory-warehouse';
import { ajiaco, caldo, changua } from '../support/recipes';
import { stockOf } from '../support/stock';

const workdayId = randomUUID();

function waitingOrder(minute: number, needs: IngredientQuantity[]) {
  return {
    orderId: randomUUID(),
    workdayId,
    waitingSince: `2026-10-22T12:${String(minute).padStart(2, '0')}:00.000Z`,
    needs,
  };
}

function reservedOrderIds(publisher: InMemoryPublisher): string[] {
  return publisher.ofType('IngredientsReserved').map(({ payload }) => payload.orderId);
}

function ingredientPurchased(
  ingredient: Ingredient,
  quantity: number,
  purchaseWorkday = workdayId,
) {
  return createEvent(
    'IngredientPurchased',
    {
      purchaseId: randomUUID(),
      shortageId: randomUUID(),
      workdayId: purchaseWorkday,
      ingredient,
      quantity,
    },
    { correlationId: randomUUID() },
  );
}

function setup() {
  const warehouse = new InMemoryWarehouse();
  warehouse.currentWorkdayId = workdayId;
  const publisher = new InMemoryPublisher();
  return { warehouse, publisher, handle: receivePurchase({ warehouse, publisher }) };
}

describe('receivePurchase', () => {
  describe('applying the purchase', () => {
    it('adds the units sold by the market to the stock', async () => {
      const { warehouse, handle } = setup();
      warehouse.stock = stockOf({ onion: 1, cheese: 2 });

      await handle(ingredientPurchased('onion', 3));

      expect(warehouse.stock).toEqual(stockOf({ onion: 4, cheese: 2 }));
    });

    it('subtracts the units received from the purchase in flight', async () => {
      const { warehouse, handle } = setup();
      warehouse.demand.onion.inFlight = 5;

      await handle(ingredientPurchased('onion', 2));

      expect(warehouse.demand.onion.inFlight).toBe(3);
    });

    it('never leaves a negative purchase in flight when the market sold more than asked', async () => {
      const { warehouse, handle } = setup();
      warehouse.demand.onion.inFlight = 1;

      await handle(ingredientPurchased('onion', 4));

      expect(warehouse.demand.onion.inFlight).toBe(0);
      expect(warehouse.stock.onion).toBe(4);
    });

    it('adds a purchase only once when the message arrives twice', async () => {
      const { warehouse, handle } = setup();
      warehouse.demand.onion.inFlight = 6;
      const purchase = ingredientPurchased('onion', 2);

      await handle(purchase);
      await handle(purchase);

      expect(warehouse.stock.onion).toBe(2);
      expect(warehouse.demand.onion.inFlight).toBe(4);
    });
  });

  describe('a late purchase from a previous workday', () => {
    it('is left out of the stock and the demand of the current workday', async () => {
      const { warehouse, publisher, handle } = setup();
      warehouse.stock = stockOf({ cheese: 2 });
      warehouse.demand.onion.inFlight = 3;
      await warehouse.enqueue(waitingOrder(0, changua));

      await handle(ingredientPurchased('onion', 3, randomUUID()));

      expect(warehouse.stock).toEqual(stockOf({ cheese: 2 }));
      expect(warehouse.demand.onion.inFlight).toBe(3);
      expect(publisher.events).toEqual([]);
    });
  });

  describe('serving the waiting list', () => {
    it('serves a newer order that fits when the oldest one still does not (flexible FIFO)', async () => {
      // 2 potatoes arrive: the Ajiaco (#1) needs 3, the Caldo (#2) needs 2
      const { warehouse, publisher, handle } = setup();
      warehouse.stock = stockOf({ chicken: 5, meat: 5, onion: 5, rice: 5 });
      const first = waitingOrder(0, ajiaco);
      const second = waitingOrder(1, caldo);
      await warehouse.enqueue(first);
      await warehouse.enqueue(second);

      await handle(ingredientPurchased('potato', 2));

      expect(reservedOrderIds(publisher)).toEqual([second.orderId]);
      expect(publisher.ofType('IngredientsReserved')[0]?.payload.workdayId).toBe(workdayId);
      expect(warehouse.waitingList).toEqual([first]);
      expect(warehouse.stock).toEqual(stockOf({ chicken: 5, meat: 3, onion: 4, rice: 5 }));
    });

    it('serves every order it can, oldest first', async () => {
      const { warehouse, publisher, handle } = setup();
      warehouse.stock = stockOf({ cheese: 6 });
      const [third, first, second] = [
        waitingOrder(2, changua),
        waitingOrder(0, changua),
        waitingOrder(1, changua),
      ];
      for (const order of [third, first, second]) {
        await warehouse.enqueue(order);
      }

      await handle(ingredientPurchased('onion', 3));

      expect(reservedOrderIds(publisher)).toEqual([first.orderId, second.orderId, third.orderId]);
      expect(warehouse.waitingList).toEqual([]);
      expect(warehouse.demand.onion.waitingNeed).toBe(0);
      expect(warehouse.demand.cheese.waitingNeed).toBe(0);
    });

    it('keeps everyone waiting and tells the kitchen nothing when no order fits yet', async () => {
      const { warehouse, publisher, handle } = setup();
      const order = waitingOrder(0, ajiaco);
      await warehouse.enqueue(order);

      await handle(ingredientPurchased('onion', 1));

      expect(publisher.ofType('IngredientsReserved')).toEqual([]);
      expect(warehouse.waitingList).toEqual([order]);
    });

    it('tells the kitchen on retry when the first attempt died before publishing the reservation', async () => {
      const { warehouse, publisher, handle } = setup();
      warehouse.stock = stockOf({ cheese: 2 });
      const order = waitingOrder(0, changua);
      await warehouse.enqueue(order);
      const purchase = ingredientPurchased('onion', 1);
      publisher.failNext('IngredientsReserved');

      await expect(handle(purchase)).rejects.toThrow('Simulated failure');
      // The order already left the waiting list: only its pending reservation can save it
      expect(warehouse.waitingList).toEqual([]);

      await handle(purchase);

      expect(reservedOrderIds(publisher)).toEqual([order.orderId]);
      expect(warehouse.stock).toEqual(stockOf({}));
    });

    it('reserves an order only once when two purchases serve the waiting list at the same time', async () => {
      const { warehouse, publisher, handle } = setup();
      warehouse.stock = stockOf({ cheese: 4, onion: 1 });
      const order = waitingOrder(0, changua);
      await warehouse.enqueue(order);

      await Promise.all([
        handle(ingredientPurchased('cheese', 1)),
        handle(ingredientPurchased('onion', 1)),
      ]);

      // The same pending reservation may be published by both: consumers are idempotent
      expect(new Set(reservedOrderIds(publisher))).toEqual(new Set([order.orderId]));
      expect(warehouse.stock).toEqual(stockOf({ cheese: 3, onion: 1 }));
    });

    it('does not tell the kitchen twice once the reservation was published', async () => {
      const { warehouse, publisher, handle } = setup();
      warehouse.stock = stockOf({ cheese: 2 });
      await warehouse.enqueue(waitingOrder(0, changua));
      const purchase = ingredientPurchased('onion', 1);

      await handle(purchase);
      await handle(purchase);

      expect(publisher.ofType('IngredientsReserved')).toHaveLength(1);
    });
  });

  describe('re-evaluating the demand', () => {
    function shortages(publisher: InMemoryPublisher) {
      return publisher.ofType('StockShortage').map(({ payload }) => ({
        ingredient: payload.ingredient,
        quantity: payload.quantity,
      }));
    }

    it('requests what the remaining orders need once the purchase in flight completes', async () => {
      // 5 Changuas wait for 1 onion each; the purchase in flight brings only 1
      const { warehouse, publisher, handle } = setup();
      warehouse.stock = stockOf({ cheese: 10 });
      for (let minute = 0; minute < 5; minute++) {
        await warehouse.enqueue(waitingOrder(minute, changua));
      }
      warehouse.demand.onion.inFlight = 1;

      await handle(ingredientPurchased('onion', 1));

      expect(publisher.ofType('IngredientsReserved')).toHaveLength(1);
      expect(shortages(publisher)).toEqual([{ ingredient: 'onion', quantity: 4 }]);
    });

    it('requests nothing more while the purchase in flight has not completed', async () => {
      const { warehouse, publisher, handle } = setup();
      await warehouse.enqueue(waitingOrder(0, changua));
      warehouse.demand.onion.inFlight = 5;
      warehouse.demand.cheese.inFlight = 2;

      await handle(ingredientPurchased('onion', 2));

      expect(shortages(publisher)).toEqual([]);
    });

    it('requests an ingredient that other orders used up while an order was waiting', async () => {
      // Onion arrives and the Caldo uses the last 2 potatoes: now the Ajiaco lacks potato,
      // and no purchase of potato is in flight
      const { warehouse, publisher, handle } = setup();
      warehouse.stock = stockOf({ chicken: 5, meat: 5, potato: 2, rice: 5 });
      const ajiacoOrder = waitingOrder(0, ajiaco);
      const caldoOrder = waitingOrder(1, caldo);
      await warehouse.enqueue(ajiacoOrder);
      await warehouse.enqueue(caldoOrder);
      warehouse.demand.onion.inFlight = 2;

      await handle(ingredientPurchased('onion', 2));

      expect(reservedOrderIds(publisher)).toEqual([caldoOrder.orderId]);
      expect(shortages(publisher)).toEqual([{ ingredient: 'potato', quantity: 3 }]);
    });
  });
});
