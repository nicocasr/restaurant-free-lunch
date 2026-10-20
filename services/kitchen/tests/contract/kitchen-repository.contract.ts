import { randomUUID } from 'node:crypto';

import type { KitchenRepository } from '../../src/application/ports';

/**
 * The behavior every adapter of the kitchen port must have. It runs against the in-memory
 * fake (unit) and against DynamoDB on LocalStack (integration).
 */
export function kitchenRepositoryContract(
  name: string,
  create: () => Promise<{ repository: KitchenRepository; dispose?: () => Promise<void> }>,
): void {
  describe(`${name} (kitchen repository contract)`, () => {
    let repository: KitchenRepository;
    let dispose: (() => Promise<void>) | undefined;

    beforeEach(async () => {
      ({ repository, dispose } = await create());
    });

    afterEach(async () => {
      await dispose?.();
    });

    const assignment = (orderId: string, recipeId: string) => ({
      orderId,
      workdayId: randomUUID(),
      recipeId,
    });

    it('has no assignment for an order the kitchen never saw', async () => {
      expect(await repository.findAssignment(randomUUID())).toBeUndefined();
    });

    it('stores the first assignment of an order and finds it', async () => {
      const ajiaco = assignment(randomUUID(), 'ajiaco');

      expect(await repository.assignOnce(ajiaco)).toEqual(ajiaco);
      expect(await repository.findAssignment(ajiaco.orderId)).toEqual(ajiaco);
    });

    it('keeps the first recipe when the order is assigned again (PLANNING §3.4)', async () => {
      const orderId = randomUUID();
      const first = assignment(orderId, 'ajiaco');
      await repository.assignOnce(first);

      expect(await repository.assignOnce(assignment(orderId, 'mazamorra'))).toEqual(first);
      expect(await repository.findAssignment(orderId)).toEqual(first);
    });

    it('keeps a single recipe when many copies are assigned at the same time', async () => {
      const orderId = randomUUID();
      const recipes = ['ajiaco', 'changua', 'picada', 'mazamorra', 'caldo-de-costilla'];

      const stored = await Promise.all(
        recipes.map((recipeId) => repository.assignOnce(assignment(orderId, recipeId))),
      );

      expect(new Set(stored.map(({ recipeId }) => recipeId)).size).toBe(1);
      expect((await repository.findAssignment(orderId))?.recipeId).toBe(stored[0]?.recipeId);
    });
  });
}
