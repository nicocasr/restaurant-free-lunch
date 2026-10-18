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

  describe('when the market has nothing to sell', () => {
    it('asks to retry later, in whole seconds, without recording or publishing a sale', async () => {
      // random 0.5 on attempt 1: half of the 1 s base = 500 ms, rounded up to 1 s
      const { purchases, publisher, handle } = setup([0]);

      const outcome = await handle(stockShortage('onion', 3));

      expect(outcome).toEqual({ status: 'retry', delaySeconds: 1 });
      expect(purchases.sales).toEqual([]);
      expect(publisher.events).toEqual([]);
    });

    it('waits longer on each retry, because the failed attempts are saved', async () => {
      const { handle } = setup([0, 0, 0]);
      const shortage = stockShortage('onion', 3);

      const delays = [];
      for (let i = 0; i < 3; i++) {
        const outcome = await handle(shortage);
        delays.push(outcome.status === 'retry' ? outcome.delaySeconds : undefined);
      }

      // half of 1 s, 2 s and 4 s, rounded up
      expect(delays).toEqual([1, 1, 2]);
    });

    it('publishes what was bought before the market ran out, and retries for the rest', async () => {
      const { publisher, handle } = setup([2, 0]);

      const outcome = await handle(stockShortage('onion', 3));

      expect(outcome).toEqual({ status: 'retry', delaySeconds: 1 });
      expect(
        publisher.ofType('IngredientPurchased').map(({ payload }) => payload.quantity),
      ).toEqual([2]);
    });

    it('buys only what is still missing when the message comes back', async () => {
      const { market, publisher, handle } = setup([2, 0, 1]);
      const shortage = stockShortage('onion', 3);

      await handle(shortage);
      const outcome = await handle(shortage);

      expect(outcome).toEqual({ status: 'completed' });
      expect(market.calls).toHaveLength(3);
      expect(
        publisher.ofType('IngredientPurchased').map(({ payload }) => payload.quantity),
      ).toEqual([2, 1]);
    });
  });
});
