import { randomUUID } from 'node:crypto';

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

    const shortage = (quantity: number) => ({
      shortageId: randomUUID(),
      workdayId: randomUUID(),
      ingredient: 'onion' as const,
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
      await repository.recordSale(saleOf(onion, 2), { requested: 3, bought: 2, failedAttempts: 0 });
      await repository.saveProgress(onion.shortageId, {
        requested: 3,
        bought: 2,
        failedAttempts: 1,
      });

      expect((await repository.startOrResume(onion)).progress).toEqual({
        requested: 3,
        bought: 2,
        failedAttempts: 1,
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
      await repository.recordSale(first, { requested: 5, bought: 2, failedAttempts: 0 });
      await repository.recordSale(second, { requested: 5, bought: 3, failedAttempts: 0 });
      await repository.recordSale(saleOf(potato, 4), {
        requested: 5,
        bought: 4,
        failedAttempts: 0,
      });

      await repository.markSalePublished(first.purchaseId);

      expect(await repository.pendingSales(onion.shortageId)).toEqual([second]);
    });
  });
}
