import { randomUUID } from 'node:crypto';

import type { Ingredient } from '@alegra-lunch/contracts';

import type { PurchaseRepository, Sale } from '../../src/application/ports';

/**
 * The behavior every adapter of the purchases port must have. It runs against the in-memory
 * fake (unit) and against DynamoDB on LocalStack (integration).
 */
export function purchaseRepositoryContract(
  name: string,
  create: () => Promise<{ repository: PurchaseRepository; dispose?: () => Promise<void> }>,
): void {
  describe(`${name} (purchase repository contract)`, () => {
    let repository: PurchaseRepository;
    let dispose: (() => Promise<void>) | undefined;

    beforeEach(async () => {
      ({ repository, dispose } = await create());
    });

    afterEach(async () => {
      await dispose?.();
    });

    const shortage = (quantity: number, ingredient: Ingredient = 'onion') => ({
      shortageId: randomUUID(),
      workdayId: randomUUID(),
      ingredient,
      quantity,
    });

    const saleOf = (from: ReturnType<typeof shortage>, quantity: number): Sale => ({
      purchaseId: randomUUID(),
      shortageId: from.shortageId,
      workdayId: from.workdayId,
      ingredient: from.ingredient,
      quantity,
    });

    it('starts a purchase with nothing bought yet', async () => {
      const onion = shortage(3);

      expect(await repository.startOrResume(onion)).toEqual({
        shortageId: onion.shortageId,
        workdayId: onion.workdayId,
        ingredient: 'onion',
        progress: { requested: 3, bought: 0, failedAttempts: 0 },
      });
    });

    it('resumes a purchase where it was left', async () => {
      const onion = shortage(3);
      await repository.startOrResume(onion);
      await repository.recordSale(saleOf(onion, 2));
      await repository.recordFailedRound(onion.shortageId);

      expect((await repository.startOrResume(onion)).progress).toEqual({
        requested: 3,
        bought: 2,
        failedAttempts: 1,
      });
    });

    it('adds every sale to what was bought, so two buyers at once never lose a count', async () => {
      // Each sale adds its units in the same write that records it (PLANNING §3.5)
      const onion = shortage(30);
      await repository.startOrResume(onion);
      const sales = Array.from({ length: 10 }, (_, index) => saleOf(onion, (index % 4) + 1));

      await Promise.all(sales.map((sale) => repository.recordSale(sale)));

      const { progress } = await repository.startOrResume(onion);
      expect(progress.bought).toBe(sales.reduce((total, { quantity }) => total + quantity, 0));
    });

    it('resets the failed attempts once the market sells again', async () => {
      const onion = shortage(5);
      await repository.startOrResume(onion);
      await repository.recordFailedRound(onion.shortageId);
      await repository.recordFailedRound(onion.shortageId);

      await repository.recordSale(saleOf(onion, 1));

      expect((await repository.startOrResume(onion)).progress).toEqual({
        requested: 5,
        bought: 1,
        failedAttempts: 0,
      });
    });

    it('keeps a single purchase when the shortage arrives many times at once', async () => {
      const onion = shortage(3);

      const records = await Promise.all(
        Array.from({ length: 5 }, () => repository.startOrResume(onion)),
      );

      expect(new Set(records.map((record) => JSON.stringify(record))).size).toBe(1);
    });

    it('keeps each sale pending to publish until it is marked as published', async () => {
      const onion = shortage(5);
      const potato = shortage(5);
      await repository.startOrResume(onion);
      await repository.startOrResume(potato);
      const first = saleOf(onion, 2);
      const second = saleOf(onion, 1);
      await repository.recordSale(first);
      await repository.recordSale(second);
      await repository.recordSale(saleOf(potato, 4));

      await repository.markSalePublished(first.purchaseId);

      expect(await repository.pendingSales(onion.shortageId)).toEqual([second]);
    });

    it('lists every sale of a workday for the purchase history, published or not', async () => {
      const onion = shortage(5);
      const potato = { ...shortage(5, 'potato'), workdayId: onion.workdayId };
      const otherWorkday = shortage(5);
      const sales = [saleOf(onion, 2), saleOf(potato, 3)];
      for (const each of [onion, potato, otherWorkday]) {
        await repository.startOrResume(each);
      }
      for (const sale of sales) {
        await repository.recordSale(sale);
      }
      await repository.recordSale(saleOf(otherWorkday, 1));
      await repository.markSalePublished(sales[0]?.purchaseId as string);

      const history = await repository.listSales(onion.workdayId);

      expect([...history].sort((a, b) => a.quantity - b.quantity)).toEqual(sales);
    });
  });
}
