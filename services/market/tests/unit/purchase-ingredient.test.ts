import { randomUUID } from 'node:crypto';

import { createEvent, type Ingredient } from '@alegra-lunch/contracts';
import { InMemoryPublisher } from '@alegra-lunch/testing';

import { purchaseIngredient } from '../../src/application/purchase-ingredient';
import { InMemoryPurchases } from '../support/in-memory-purchases';
import { ScriptedFarmersMarket } from '../support/scripted-farmers-market';

function stockShortage(ingredient: Ingredient, quantity: number) {
  return createEvent(
    'StockShortage',
    { shortageId: randomUUID(), workdayId: randomUUID(), ingredient, quantity },
    { correlationId: randomUUID() },
  );
}

function setup(answers: number[]) {
  const market = new ScriptedFarmersMarket(answers);
  const purchases = new InMemoryPurchases();
  const publisher = new InMemoryPublisher();
  const handle = purchaseIngredient({ market, purchases, publisher, random: () => 0.5 });
  return { market, purchases, publisher, handle };
}

describe('purchaseIngredient', () => {
  describe('when the market has stock', () => {
    it('keeps buying until the shortage is covered', async () => {
      const { market, handle } = setup([2, 2]);

      const outcome = await handle(stockShortage('onion', 3));

      expect(outcome).toEqual({ status: 'completed' });
      expect(market.calls).toEqual(['onion', 'onion']);
    });

    it('sends every sale to the warehouse right away, so it can serve orders sooner', async () => {
      const { publisher, handle } = setup([2, 2]);
      const shortage = stockShortage('onion', 3);

      await handle(shortage);

      const purchased = publisher.ofType('IngredientPurchased');
      expect(purchased.map(({ payload }) => payload.quantity)).toEqual([2, 2]);
      for (const { correlationId, payload } of purchased) {
        expect(correlationId).toBe(shortage.correlationId);
        expect(payload).toMatchObject({
          shortageId: shortage.payload.shortageId,
          workdayId: shortage.payload.workdayId,
          ingredient: 'onion',
        });
      }
      expect(new Set(purchased.map(({ payload }) => payload.purchaseId)).size).toBe(2);
    });

    it('keeps every sale in the purchase history', async () => {
      const { purchases, publisher, handle } = setup([1, 4]);

      await handle(stockShortage('potato', 3));

      expect(purchases.sales).toEqual(
        publisher.ofType('IngredientPurchased').map(({ payload }) => payload),
      );
      expect(purchases.sales.map(({ quantity }) => quantity)).toEqual([1, 4]);
    });
  });
});
