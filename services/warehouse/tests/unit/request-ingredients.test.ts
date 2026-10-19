import { randomUUID } from 'node:crypto';

import { createEvent, type IngredientQuantity } from '@alegra-lunch/contracts';
import { InMemoryPublisher } from '@alegra-lunch/testing';

import {
  WorkdayNotStartedError,
  requestIngredients,
} from '../../src/application/request-ingredients';
import { initialStock } from '../../src/domain/stock';
import { InMemoryWarehouse } from '../support/in-memory-warehouse';
import { ajiaco, changua } from '../support/recipes';
import { stockOf } from '../support/stock';

const workdayId = randomUUID();

function ingredientsRequested(ingredients: IngredientQuantity[], orderWorkday = workdayId) {
  return createEvent(
    'IngredientsRequested',
    {
      orderId: randomUUID(),
      workdayId: orderWorkday,
      recipeId: 'changua',
      recipeName: 'Changua con queso',
      ingredients,
    },
    { correlationId: randomUUID() },
  );
}

function setup() {
  const warehouse = new InMemoryWarehouse();
  warehouse.currentWorkdayId = workdayId;
  const publisher = new InMemoryPublisher();
  return { warehouse, publisher, handle: requestIngredients({ warehouse, publisher }) };
}

describe('requestIngredients', () => {
  describe('when the order belongs to a workday the warehouse has not started yet', () => {
    // WorkdayStarted travels in one hop and IngredientsRequested in two, but SQS does not
    // guarantee the order: the request must wait for the reset to 5 units (PLANNING §3.7)
    it('fails without touching the stock, so the message is retried later', async () => {
      const { warehouse, publisher, handle } = setup();
      warehouse.stock = stockOf({ cheese: 1, onion: 9 });

      await expect(handle(ingredientsRequested(changua, randomUUID()))).rejects.toThrow(
        WorkdayNotStartedError,
      );

      expect(warehouse.stock).toEqual(stockOf({ cheese: 1, onion: 9 }));
      expect(warehouse.waitingList).toEqual([]);
      expect(publisher.events).toEqual([]);
    });

    it('reserves against the fresh stock once the workday has started', async () => {
      const { warehouse, publisher, handle } = setup();
      const nextWorkday = randomUUID();
      const request = ingredientsRequested(changua, nextWorkday);
      await expect(handle(request)).rejects.toThrow(WorkdayNotStartedError);

      await warehouse.startWorkday(nextWorkday, initialStock());
      await handle(request);

      expect(publisher.ofType('IngredientsReserved')).toHaveLength(1);
      expect(warehouse.stock).toEqual({ ...initialStock(), cheese: 3, onion: 4 });
    });
  });

  describe('when there is enough stock', () => {
    it('deducts the ingredients of the recipe', async () => {
      const { warehouse, handle } = setup();
      warehouse.stock = stockOf({ cheese: 5, onion: 5 });

      await handle(ingredientsRequested(changua));

      expect(warehouse.stock).toEqual(stockOf({ cheese: 3, onion: 4 }));
    });

    it('tells the kitchen the order can be prepared', async () => {
      const { warehouse, publisher, handle } = setup();
      warehouse.stock = stockOf({ cheese: 5, onion: 5 });
      const request = ingredientsRequested(changua);

      await handle(request);

      expect(publisher.events).toHaveLength(1);
      expect(publisher.ofType('IngredientsReserved')).toEqual([
        expect.objectContaining({
          correlationId: request.correlationId,
          payload: { orderId: request.payload.orderId, workdayId: request.payload.workdayId },
        }),
      ]);
    });
  });

  describe('when some ingredient is short', () => {
    // Plenty of everything except onion
    const stockWithoutOnion = stockOf({ chicken: 5, potato: 5, rice: 5 });

    it('deducts nothing and puts the order in the waiting list', async () => {
      const { warehouse, handle } = setup();
      warehouse.stock = stockWithoutOnion;
      const request = ingredientsRequested(ajiaco);

      await handle(request);

      expect(warehouse.stock).toEqual(stockWithoutOnion);
      expect(warehouse.waitingList).toEqual([
        {
          orderId: request.payload.orderId,
          workdayId: request.payload.workdayId,
          waitingSince: request.occurredAt,
          needs: ajiaco,
        },
      ]);
    });

    it('tells orders and the dashboard exactly what the order lacks', async () => {
      const { warehouse, publisher, handle } = setup();
      warehouse.stock = stockWithoutOnion;
      const request = ingredientsRequested(ajiaco);

      await handle(request);

      expect(publisher.ofType('IngredientsReserved')).toEqual([]);
      expect(publisher.ofType('OrderWaitingIngredients')).toEqual([
        expect.objectContaining({
          correlationId: request.correlationId,
          payload: {
            orderId: request.payload.orderId,
            workdayId: request.payload.workdayId,
            missing: [{ ingredient: 'onion', quantity: 1 }],
          },
        }),
      ]);
    });

    it('adds the need of every ingredient of the order to the demand, not only the missing ones', async () => {
      const { warehouse, handle } = setup();
      warehouse.stock = stockWithoutOnion;

      await handle(ingredientsRequested(ajiaco));

      expect(warehouse.demand.onion.waitingNeed).toBe(1);
      expect(warehouse.demand.potato.waitingNeed).toBe(3);
      expect(warehouse.demand.chicken.waitingNeed).toBe(2);
      expect(warehouse.demand.rice.waitingNeed).toBe(1);
      expect(warehouse.demand.cheese.waitingNeed).toBe(0);
    });

    it('lists the order and counts its need once when the message arrives twice', async () => {
      const { warehouse, publisher, handle } = setup();
      warehouse.stock = stockWithoutOnion;
      const request = ingredientsRequested(ajiaco);

      await handle(request);
      await handle(request);

      expect(warehouse.waitingList).toHaveLength(1);
      expect(warehouse.demand.onion.waitingNeed).toBe(1);
      expect(publisher.ofType('OrderWaitingIngredients')).toHaveLength(2);
    });
  });

  describe('when stock arrives between the failed reservation and joining the waiting list', () => {
    // The purchase scanned the waiting list before this order was in it: without a retry,
    // the order would wait forever even though the stock is there (lost wakeup).
    function setupRace() {
      const context = setup();
      context.warehouse.beforeEnqueue = () => {
        context.warehouse.stock = stockOf({ cheese: 5, onion: 5 });
      };
      return context;
    }

    it('reserves the order right away and takes it out of the waiting list', async () => {
      const { warehouse, handle } = setupRace();

      await handle(ingredientsRequested(changua));

      expect(warehouse.stock).toEqual(stockOf({ cheese: 3, onion: 4 }));
      expect(warehouse.waitingList).toEqual([]);
      expect(warehouse.demand.onion.waitingNeed).toBe(0);
      expect(warehouse.demand.cheese.waitingNeed).toBe(0);
    });

    it('tells the kitchen to cook and neither reports a wait nor buys anything', async () => {
      const { publisher, handle } = setupRace();
      const request = ingredientsRequested(changua);

      await handle(request);

      expect(publisher.events.map(({ type }) => type)).toEqual(['IngredientsReserved']);
      expect(publisher.ofType('IngredientsReserved')[0]?.payload).toEqual({
        orderId: request.payload.orderId,
        workdayId: request.payload.workdayId,
      });
    });

    it('tells the kitchen when another process took the order out first and died before telling', async () => {
      // The other process reserved the order (leaving it pending to publish) and died: this
      // one finds it gone from the waiting list and publishes the pending reservation
      const { warehouse, publisher, handle } = setupRace();
      const takeOut = warehouse.reserveFromWaiting.bind(warehouse);
      jest.spyOn(warehouse, 'reserveFromWaiting').mockImplementationOnce(async (order) => {
        await takeOut(order);
        return 'not-waiting';
      });
      const request = ingredientsRequested(changua);

      await handle(request);

      expect(publisher.ofType('IngredientsReserved').map(({ payload }) => payload.orderId)).toEqual(
        [request.payload.orderId],
      );
      expect(await warehouse.pendingReservations()).toEqual([]);
    });

    it('does not deduct twice when the message is redelivered', async () => {
      const { warehouse, publisher, handle } = setupRace();
      const request = ingredientsRequested(changua);

      await handle(request);
      await handle(request);

      expect(warehouse.stock).toEqual(stockOf({ cheese: 3, onion: 4 }));
      expect(publisher.ofType('IngredientsReserved')).toHaveLength(2);
    });
  });

  describe('purchase requests to the market', () => {
    it('does not look for unpublished purchases of an ingredient with none in flight', async () => {
      // An unpublished shortage always leaves units in flight, so with none there is nothing
      // to look for: one database query less per ingredient
      const { warehouse, handle } = setup();
      warehouse.stock = stockOf({ cheese: 1, onion: 5 });
      const pending = jest.spyOn(warehouse, 'pendingShortages');

      await handle(ingredientsRequested(changua));

      const looked = pending.mock.calls.map(([ingredient]) => ingredient);
      expect(looked).not.toContain('onion');
    });

    it('requests only the missing ingredients', async () => {
      const { warehouse, publisher, handle } = setup();
      warehouse.stock = stockOf({ chicken: 5, potato: 5, rice: 5 });
      const request = ingredientsRequested(ajiaco);

      await handle(request);

      expect(publisher.ofType('StockShortage')).toEqual([
        expect.objectContaining({
          correlationId: request.correlationId,
          payload: {
            shortageId: expect.any(String) as string,
            workdayId: request.payload.workdayId,
            ingredient: 'onion',
            quantity: 1,
          },
        }),
      ]);
    });

    it('keeps one active purchase per ingredient while orders keep arriving', async () => {
      const { warehouse, publisher, handle } = setup();
      warehouse.stock = stockOf({ cheese: 10 });

      await handle(ingredientsRequested(changua));
      await handle(ingredientsRequested(changua));
      await handle(ingredientsRequested(changua));

      expect(publisher.ofType('StockShortage').map(({ payload }) => payload.quantity)).toEqual([1]);
      expect(warehouse.demand.onion).toEqual({ waitingNeed: 3, inFlight: 1 });
    });

    // Both evaluations may publish the same pending shortage: delivery is at-least-once and the
    // market is idempotent per shortageId (§3.6). What must never happen is two shortages.
    it('registers a single purchase when two orders are evaluated at the same time', async () => {
      const { warehouse, publisher, handle } = setup();

      await Promise.all([
        handle(ingredientsRequested(changua)),
        handle(ingredientsRequested(changua)),
      ]);

      const onionShortages = publisher
        .ofType('StockShortage')
        .filter(({ payload }) => payload.ingredient === 'onion');
      const distinct = new Set(onionShortages.map(({ payload }) => payload.shortageId));
      expect(distinct.size).toBe(1);
      expect(warehouse.demand.onion.inFlight).toBe(onionShortages[0]?.payload.quantity);
    });

    it('publishes the pending purchase on retry when the first attempt died before publishing it', async () => {
      const { warehouse, publisher, handle } = setup();
      warehouse.stock = stockOf({ cheese: 10 });
      const request = ingredientsRequested(changua);
      publisher.failNext('StockShortage');

      await expect(handle(request)).rejects.toThrow('Simulated failure');
      expect(publisher.ofType('StockShortage')).toEqual([]);

      await handle(request);

      expect(publisher.ofType('StockShortage').map(({ payload }) => payload.quantity)).toEqual([1]);
      expect(warehouse.demand.onion.inFlight).toBe(1);
    });

    it('does not publish the same purchase again once it was published', async () => {
      const { warehouse, publisher, handle } = setup();
      warehouse.stock = stockOf({ cheese: 10 });
      const request = ingredientsRequested(changua);

      await handle(request);
      await handle(request);

      expect(publisher.ofType('StockShortage')).toHaveLength(1);
    });
  });

  describe('when the same message arrives twice (SQS is at-least-once)', () => {
    it('deducts the ingredients only once', async () => {
      const { warehouse, handle } = setup();
      warehouse.stock = stockOf({ cheese: 5, onion: 5 });
      const request = ingredientsRequested(changua);

      await handle(request);
      await handle(request);

      expect(warehouse.stock).toEqual(stockOf({ cheese: 3, onion: 4 }));
    });

    it('publishes IngredientsReserved again, in case the first attempt died before publishing', async () => {
      const { warehouse, publisher, handle } = setup();
      warehouse.stock = stockOf({ cheese: 5, onion: 5 });
      const request = ingredientsRequested(changua);

      await handle(request);
      await handle(request);

      const reserved = publisher.ofType('IngredientsReserved');
      expect(reserved).toHaveLength(2);
      expect(reserved[1]?.payload).toEqual(reserved[0]?.payload);
    });

    it('still treats it as reserved when the first attempt used the last units', async () => {
      const { warehouse, publisher, handle } = setup();
      warehouse.stock = stockOf({ cheese: 2, onion: 1 });
      const request = ingredientsRequested(changua);

      await handle(request);
      await handle(request);

      expect(warehouse.stock).toEqual(stockOf({}));
      expect(publisher.events.map(({ type }) => type)).toEqual([
        'IngredientsReserved',
        'IngredientsReserved',
      ]);
    });
  });
});
