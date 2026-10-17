import { randomUUID } from 'node:crypto';

import { createEvent, type Ingredient } from '@alegra-lunch/contracts';

import { receivePurchase } from '../../src/application/receive-purchase';
import { InMemoryPublisher } from '../support/in-memory-publisher';
import { InMemoryWarehouse } from '../support/in-memory-warehouse';
import { stockOf } from '../support/stock';

function ingredientPurchased(ingredient: Ingredient, quantity: number) {
  return createEvent(
    'IngredientPurchased',
    {
      purchaseId: randomUUID(),
      shortageId: randomUUID(),
      workdayId: randomUUID(),
      ingredient,
      quantity,
    },
    { correlationId: randomUUID() },
  );
}

function setup() {
  const warehouse = new InMemoryWarehouse();
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
});
