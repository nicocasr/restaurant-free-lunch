import { randomUUID } from 'node:crypto';

import { createEvent, type IngredientQuantity } from '@alegra-lunch/contracts';

import { requestIngredients } from '../../src/application/request-ingredients';
import { InMemoryPublisher } from '../support/in-memory-publisher';
import { InMemoryWarehouse } from '../support/in-memory-warehouse';
import { stockOf } from '../support/stock';

const changua: IngredientQuantity[] = [
  { ingredient: 'cheese', quantity: 2 },
  { ingredient: 'onion', quantity: 1 },
];

function ingredientsRequested(ingredients: IngredientQuantity[]) {
  return createEvent(
    'IngredientsRequested',
    {
      orderId: randomUUID(),
      workdayId: randomUUID(),
      recipeId: 'changua',
      recipeName: 'Changua con queso',
      ingredients,
    },
    { correlationId: randomUUID() },
  );
}

function setup() {
  const warehouse = new InMemoryWarehouse();
  const publisher = new InMemoryPublisher();
  return { warehouse, publisher, handle: requestIngredients({ warehouse, publisher }) };
}

describe('requestIngredients', () => {
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
});
