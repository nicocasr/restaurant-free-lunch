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

/** Without a clock, the use case runs with its real clock and default budget. */
function setup(answers: (number | Error)[], clock?: () => number) {
  const market = new ScriptedFarmersMarket(answers);
  const purchases = new InMemoryPurchases();
  const publisher = new InMemoryPublisher();
  const handle = purchaseIngredient({
    market,
    purchases,
    publisher,
    random: () => 0.5,
    ...(clock && { clock, budgetMs: 10_000 }),
  });
  return { market, purchases, publisher, handle };
}

/** Each round of calls costs one call to clock(): a clock that moves 4 s per reading. */
function slowClock(): () => number {
  let now = 0;
  return () => (now += 4_000);
}

describe('purchaseIngredient', () => {
  describe('when the market has stock', () => {
    it('keeps buying until the shortage is covered', async () => {
      const { market, handle } = setup([2, 2]);

      const outcome = await handle(stockShortage('onion', 3));

      expect(outcome).toEqual({ status: 'completed' });
      expect(market.calls).toEqual(['onion', 'onion']);
    });

    it('sends each round to the warehouse as one purchase, right away', async () => {
      // One event per round, not per call: the warehouse handles a few purchases of an
      // ingredient instead of many that would contend for the same stock (PLANNING §3.3)
      const { publisher, handle } = setup([2, 2]);
      const shortage = stockShortage('onion', 3);

      await handle(shortage);

      const purchased = publisher.ofType('IngredientPurchased');
      expect(purchased.map(({ payload }) => payload.quantity)).toEqual([4]);
      for (const { correlationId, payload } of purchased) {
        expect(correlationId).toBe(shortage.correlationId);
        expect(payload).toMatchObject({
          shortageId: shortage.payload.shortageId,
          workdayId: shortage.payload.workdayId,
          ingredient: 'onion',
        });
      }
      expect(purchased).toHaveLength(1);
    });

    it('calls the market several times at once while much is missing (PLANNING §3.5)', async () => {
      // 10 missing: a round of 4 calls; then 2 missing: a round of 1 call
      const { market, handle } = setup([2, 2, 2, 2, 2]);

      expect(await handle(stockShortage('onion', 10))).toEqual({ status: 'completed' });

      expect(market.maxCallsAtOnce).toBe(4);
      expect(market.calls).toHaveLength(5);
    });

    it('keeps the sales of a round when one of its calls fails, before retrying', async () => {
      const { purchases, handle } = setup([2, new Error('market timeout'), 1, 3]);

      await expect(handle(stockShortage('onion', 10))).rejects.toThrow('market timeout');

      expect(purchases.sales.map(({ quantity }) => quantity)).toEqual([6]);
    });

    it('stops after its time budget and hands the rest to the queue, keeping the progress', async () => {
      // A long purchase must never outlast the visibility of its message, or SQS would hand
      // the same shortage to a second buyer (PLANNING §3.3)
      const { market, purchases, handle } = setup(Array<number>(15).fill(1), slowClock());
      const shortage = stockShortage('onion', 15);

      expect(await handle(shortage)).toEqual({ status: 'retry', delaySeconds: 0 });
      const boughtInFirstSlice = purchases.sales.length;
      expect(boughtInFirstSlice).toBeGreaterThan(0);
      expect(boughtInFirstSlice).toBeLessThan(15);

      // The next delivery resumes: it buys only the rest, never what the first slice bought
      expect(await handle(shortage)).toEqual({ status: 'completed' });
      expect(market.calls).toHaveLength(15);
      expect(purchases.sales.reduce((total, { quantity }) => total + quantity, 0)).toBe(15);
    });

    it('keeps every sale in the purchase history', async () => {
      const { purchases, publisher, handle } = setup([1, 4]);

      await handle(stockShortage('potato', 3));

      expect(purchases.sales).toEqual(
        publisher.ofType('IngredientPurchased').map(({ payload }) => payload),
      );
      expect(purchases.sales.map(({ quantity }) => quantity)).toEqual([5]);
    });
  });

  describe('when the market has nothing to sell', () => {
    it('asks to retry later, in whole seconds, without recording or publishing a sale', async () => {
      // random 0.5 on attempt 1: half of the 1 s base = 500 ms, rounded up to 1 s
      const { purchases, publisher, handle } = setup([0, 0]);

      const outcome = await handle(stockShortage('onion', 3));

      expect(outcome).toEqual({ status: 'retry', delaySeconds: 1 });
      expect(purchases.sales).toEqual([]);
      expect(publisher.events).toEqual([]);
    });

    it('waits longer on each retry, because the failed attempts are saved', async () => {
      const { handle } = setup([0, 0, 0, 0, 0, 0]);
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
      const { publisher, handle } = setup([2, 0, 0]);

      const outcome = await handle(stockShortage('onion', 3));

      expect(outcome).toEqual({ status: 'retry', delaySeconds: 1 });
      expect(
        publisher.ofType('IngredientPurchased').map(({ payload }) => payload.quantity),
      ).toEqual([2]);
    });

    it('buys only what is still missing when the message comes back', async () => {
      const { market, publisher, handle } = setup([2, 0, 0, 1]);
      const shortage = stockShortage('onion', 3);

      await handle(shortage);
      const outcome = await handle(shortage);

      expect(outcome).toEqual({ status: 'completed' });
      expect(market.calls).toHaveLength(4);
      expect(
        publisher.ofType('IngredientPurchased').map(({ payload }) => payload.quantity),
      ).toEqual([2, 1]);
    });
  });

  describe('when the message comes back after a crash or a duplicate delivery', () => {
    function quantities(publisher: InMemoryPublisher): number[] {
      return publisher.ofType('IngredientPurchased').map(({ payload }) => payload.quantity);
    }

    it('does not call the market again for a shortage that is already covered', async () => {
      // The script has just the answers of one round: another call would fail the test
      const { market, handle } = setup([3, 0]);
      const shortage = stockShortage('onion', 3);

      await handle(shortage);
      const outcome = await handle(shortage);

      expect(outcome).toEqual({ status: 'completed' });
      expect(market.calls).toHaveLength(2);
    });

    it('publishes a sale recorded before the process died, without buying it again', async () => {
      const { market, purchases, publisher, handle } = setup([2, 1]);
      const shortage = stockShortage('onion', 3);
      publisher.failNext('IngredientPurchased');

      await expect(handle(shortage)).rejects.toThrow('Simulated failure');
      // The sale of the round is recorded before it is published
      expect(purchases.sales.map(({ quantity }) => quantity)).toEqual([3]);

      const outcome = await handle(shortage);

      expect(outcome).toEqual({ status: 'completed' });
      expect(quantities(publisher)).toEqual([3]);
      expect(publisher.ofType('IngredientPurchased')[0]?.payload.purchaseId).toBe(
        purchases.sales[0]?.purchaseId,
      );
      expect(market.calls).toHaveLength(2);
    });

    it('does not publish a sale twice once it was published', async () => {
      const { publisher, handle } = setup([2, 0, 0, 1]);
      const shortage = stockShortage('onion', 3);

      await handle(shortage);
      await handle(shortage);

      expect(quantities(publisher)).toEqual([2, 1]);
    });
  });
});
