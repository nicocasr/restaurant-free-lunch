import { randomUUID } from 'node:crypto';

import type { OrderRecord, OrdersRepository } from '../../src/application/ports';

/**
 * The behavior every adapter of the orders port must have. It runs against the in-memory
 * fake (unit) and against DynamoDB on LocalStack (integration).
 */
export function ordersRepositoryContract(
  name: string,
  create: () => Promise<{ repository: OrdersRepository; dispose?: () => Promise<void> }>,
): void {
  describe(`${name} (orders repository contract)`, () => {
    let repository: OrdersRepository;
    let dispose: (() => Promise<void>) | undefined;
    const workdayId = randomUUID();

    beforeEach(async () => {
      ({ repository, dispose } = await create());
    });

    afterEach(async () => {
      await dispose?.();
    });

    const placed = (count: number, workday = workdayId): OrderRecord[] =>
      Array.from({ length: count }, () => ({
        orderId: randomUUID(),
        batchId: randomUUID(),
        workdayId: workday,
        status: 'PLACED' as const,
      }));

    const find = async (orderId: string) =>
      (await repository.listOrders(workdayId)).find((order) => order.orderId === orderId);

    describe('workdays', () => {
      it('has no active workday before the first one', async () => {
        expect(await repository.activeWorkday()).toBeUndefined();
      });

      it('switches only from the workday that is still active', async () => {
        const [first, second, third] = [randomUUID(), randomUUID(), randomUUID()];

        expect(await repository.switchWorkday(undefined, first)).toBe(true);
        expect(await repository.switchWorkday(undefined, second)).toBe(false);
        expect(await repository.switchWorkday(first, second)).toBe(true);
        expect(await repository.switchWorkday(first, third)).toBe(false);

        expect(await repository.activeWorkday()).toBe(second);
      });

      it('lets only one of many simultaneous switches win', async () => {
        const current = randomUUID();
        await repository.switchWorkday(undefined, current);

        const outcomes = await Promise.all(
          Array.from({ length: 5 }, () => repository.switchWorkday(current, randomUUID())),
        );

        expect(outcomes.filter(Boolean)).toHaveLength(1);
      });

      it('keeps every new workday pending to announce until it is announced', async () => {
        const first = randomUUID();
        const second = randomUUID();
        await repository.switchWorkday(undefined, first);
        await repository.switchWorkday(first, second);

        await repository.markWorkdayAnnounced(first);

        expect(await repository.pendingWorkdays()).toEqual([second]);
      });
    });

    describe('batches', () => {
      it('stores a batch once and returns the stored one on every repeat', async () => {
        const batch = { batchId: randomUUID(), workdayId, orderIds: [randomUUID()] };

        expect(await repository.createBatch(batch)).toEqual(batch);
        expect(await repository.createBatch({ ...batch, orderIds: [randomUUID()] })).toEqual(batch);
      });

      it('keeps the ids of a batch of a thousand dishes', async () => {
        const batch = {
          batchId: randomUUID(),
          workdayId,
          orderIds: Array.from({ length: 1_000 }, () => randomUUID()),
        };

        expect(await repository.createBatch(batch)).toEqual(batch);
      });
    });

    describe('orders', () => {
      it('lists the orders of a workday and counts the ones in progress', async () => {
        const orders = placed(3);
        await repository.saveNewOrders([...orders, ...placed(2, randomUUID())]);

        expect(await repository.listOrders(workdayId)).toHaveLength(3);
        expect(await repository.countInProgress(workdayId)).toBe(3);
      });

      it('counts each order once, however many times it is saved', async () => {
        const orders = placed(120); // more than one DynamoDB transaction can hold
        await repository.saveNewOrders(orders);
        await repository.saveNewOrders(orders);

        expect(await repository.countInProgress(workdayId)).toBe(120);
        expect(await repository.listOrders(workdayId)).toHaveLength(120);
      });

      it('keeps the status of an order that moved on when it is saved again', async () => {
        const orders = placed(1);
        await repository.saveNewOrders(orders);
        const [order] = orders as [OrderRecord];
        await repository.updateOrder(order, { status: 'PREPARING' });

        await repository.saveNewOrders(orders);

        expect((await find(order.orderId))?.status).toBe('PREPARING');
      });

      it('only moves an order forward, and counts a delivery once', async () => {
        const [order] = placed(1) as [OrderRecord];
        await repository.saveNewOrders([order]);

        await repository.updateOrder(order, { status: 'DELIVERED' });
        await repository.updateOrder(order, { status: 'PREPARING' });
        await repository.updateOrder(order, { status: 'DELIVERED' });

        expect((await find(order.orderId))?.status).toBe('DELIVERED');
        expect(await repository.countInProgress(workdayId)).toBe(0);
      });

      it('keeps the recipe even when it arrives after a later status', async () => {
        const [order] = placed(1) as [OrderRecord];
        await repository.saveNewOrders([order]);

        await repository.updateOrder(order, { status: 'PREPARING' });
        await repository.updateOrder(order, {
          status: 'COOKING_REQUESTED',
          recipe: { recipeId: 'ajiaco', recipeName: 'Ajiaco santafereño' },
        });

        expect(await find(order.orderId)).toMatchObject({
          status: 'PREPARING',
          recipeId: 'ajiaco',
          recipeName: 'Ajiaco santafereño',
        });
      });

      it('keeps the waiting details only when the order actually starts waiting', async () => {
        const [waiting, late] = placed(2) as [OrderRecord, OrderRecord];
        await repository.saveNewOrders([waiting, late]);
        const details = {
          missing: [{ ingredient: 'onion' as const, quantity: 1 }],
          since: '2026-10-22T12:00:00.000Z',
        };

        await repository.updateOrder(waiting, { status: 'WAITING_INGREDIENTS', waiting: details });
        await repository.updateOrder(late, { status: 'PREPARING' });
        await repository.updateOrder(late, { status: 'WAITING_INGREDIENTS', waiting: details });

        expect(await find(waiting.orderId)).toMatchObject({
          missing: details.missing,
          waitingSince: details.since,
        });
        expect((await find(late.orderId))?.missing).toBeUndefined();
      });

      it('counts every delivery when many orders are delivered at the same time', async () => {
        const orders = placed(30);
        await repository.saveNewOrders(orders);

        await Promise.all(
          orders.map((order) => repository.updateOrder(order, { status: 'DELIVERED' })),
        );

        expect(await repository.countInProgress(workdayId)).toBe(0);
      });
    });
  });
}
