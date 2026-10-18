import { randomUUID } from 'node:crypto';

import type { Ingredient } from '@alegra-lunch/contracts';

import type { WarehouseRepository } from '../../src/application/ports';
import type { WaitingOrder } from '../../src/domain/waiting-list';
import { changua } from '../support/recipes';
import { stockOf } from '../support/stock';

/**
 * The behavior every adapter of the warehouse port must have. It runs against the in-memory
 * fake (unit) and against DynamoDB on LocalStack (integration): passing both proves the fake
 * behaves like the real database, so the use case specs hold in production too.
 */
export function warehouseRepositoryContract(
  name: string,
  create: () => Promise<{ repository: WarehouseRepository; dispose?: () => Promise<void> }>,
): void {
  describe(`${name} (warehouse repository contract)`, () => {
    let repository: WarehouseRepository;
    let dispose: (() => Promise<void>) | undefined;
    const workdayId = randomUUID();

    beforeEach(async () => {
      ({ repository, dispose } = await create());
    });

    afterEach(async () => {
      await dispose?.();
    });

    const startWith = (quantities: Partial<Record<Ingredient, number>>) =>
      repository.startWorkday(workdayId, stockOf(quantities));

    const waiting = (minute: number, needs = changua): WaitingOrder => ({
      orderId: randomUUID(),
      workdayId,
      waitingSince: `2026-10-22T12:${String(minute).padStart(2, '0')}:00.000Z`,
      needs,
    });

    const shortage = (ingredient: Ingredient, quantity: number) => ({
      shortageId: randomUUID(),
      workdayId,
      ingredient,
      quantity,
    });

    describe('workdays', () => {
      it('has no active workday before the first one starts', async () => {
        expect(await repository.activeWorkday()).toBeUndefined();
      });

      it('makes the workday active and replaces the whole stock', async () => {
        expect(await startWith({ onion: 5, cheese: 2 })).toBe('applied');

        expect(await repository.activeWorkday()).toBe(workdayId);
        expect(await repository.readStock()).toEqual(stockOf({ onion: 5, cheese: 2 }));
      });

      it('starts each workday only once', async () => {
        await startWith({ onion: 5 });
        await repository.reserve(randomUUID(), [{ ingredient: 'onion', quantity: 2 }]);

        expect(await startWith({ onion: 5 })).toBe('duplicate');
        expect((await repository.readStock()).onion).toBe(3);
      });

      it('resets the demand and drops the shortages not yet published', async () => {
        await startWith({});
        await repository.enqueue(waiting(0));
        const { version } = await repository.readIngredient('onion');
        await repository.registerShortage(shortage('onion', 1), version);

        await repository.startWorkday(randomUUID(), stockOf({ onion: 5 }));

        expect((await repository.readIngredient('onion')).demand).toEqual({
          waitingNeed: 0,
          inFlight: 0,
        });
        expect(await repository.pendingShortages('onion')).toEqual([]);
      });
    });

    describe('reserve', () => {
      it('deducts every ingredient when there is enough stock', async () => {
        await startWith({ cheese: 5, onion: 5 });

        expect(await repository.reserve(randomUUID(), changua)).toEqual({ status: 'reserved' });
        expect(await repository.readStock()).toEqual(stockOf({ cheese: 3, onion: 4 }));
      });

      it('deducts nothing and reports the exact shortfall when stock is short', async () => {
        await startWith({ cheese: 1, onion: 5 });

        expect(await repository.reserve(randomUUID(), changua)).toEqual({
          status: 'insufficient',
          missing: [{ ingredient: 'cheese', quantity: 1 }],
        });
        expect(await repository.readStock()).toEqual(stockOf({ cheese: 1, onion: 5 }));
      });

      it('reserves an order once, even when its stock has run out since', async () => {
        await startWith({ cheese: 2, onion: 1 });
        const orderId = randomUUID();

        await repository.reserve(orderId, changua);

        expect(await repository.reserve(orderId, changua)).toEqual({ status: 'duplicate' });
        expect(await repository.readStock()).toEqual(stockOf({}));
      });

      it('never lets concurrent reservations take the same units (PLANNING §3.5)', async () => {
        // Enough cheese for exactly 25 Changuas; 100 orders arrive at the same time
        await startWith({ cheese: 50, onion: 30 });

        const outcomes = await Promise.all(
          Array.from({ length: 100 }, () => repository.reserve(randomUUID(), changua)),
        );

        const reserved = outcomes.filter(({ status }) => status === 'reserved').length;
        expect(reserved).toBe(25);
        expect(await repository.readStock()).toEqual(stockOf({ cheese: 0, onion: 5 }));
      });
    });

    describe('waiting list', () => {
      it('lists an order once and adds the need of every ingredient to the demand', async () => {
        await startWith({});
        const order = waiting(0);

        expect(await repository.enqueue(order)).toBe('applied');
        expect(await repository.enqueue(order)).toBe('duplicate');

        expect(await repository.waitingOrders()).toEqual([order]);
        expect((await repository.readIngredient('cheese')).demand.waitingNeed).toBe(2);
        expect((await repository.readIngredient('onion')).demand.waitingNeed).toBe(1);
      });

      it('takes a waiting order out once, keeping its reservation pending to publish', async () => {
        await startWith({ cheese: 2, onion: 1 });
        const order = waiting(0);
        await repository.enqueue(order);

        expect(await repository.reserveFromWaiting(order)).toBe('reserved');
        expect(await repository.reserveFromWaiting(order)).toBe('not-waiting');

        expect(await repository.waitingOrders()).toEqual([]);
        expect(await repository.readStock()).toEqual(stockOf({}));
        expect((await repository.readIngredient('onion')).demand.waitingNeed).toBe(0);
        expect(await repository.pendingReservations()).toEqual([
          { orderId: order.orderId, workdayId },
        ]);
        expect(await repository.reserve(order.orderId, changua)).toEqual({ status: 'duplicate' });
      });

      it('leaves a waiting order in the list when its stock is still short', async () => {
        await startWith({ cheese: 2 });
        const order = waiting(0);
        await repository.enqueue(order);

        expect(await repository.reserveFromWaiting(order)).toBe('insufficient');
        expect(await repository.waitingOrders()).toEqual([order]);
        expect(await repository.readStock()).toEqual(stockOf({ cheese: 2 }));
      });

      it('lets only one of two concurrent attempts take the same order out', async () => {
        await startWith({ cheese: 4, onion: 2 });
        const order = waiting(0);
        await repository.enqueue(order);

        const outcomes = await Promise.all([
          repository.reserveFromWaiting(order),
          repository.reserveFromWaiting(order),
        ]);

        expect(outcomes.filter((outcome) => outcome === 'reserved')).toHaveLength(1);
        expect(await repository.readStock()).toEqual(stockOf({ cheese: 2, onion: 1 }));
      });

      it('forgets a pending reservation once it is published', async () => {
        await startWith({ cheese: 2, onion: 1 });
        const order = waiting(0);
        await repository.enqueue(order);
        await repository.reserveFromWaiting(order);

        await repository.markReservationPublished(order.orderId);

        expect(await repository.pendingReservations()).toEqual([]);
      });
    });

    describe('purchases', () => {
      const purchase = (quantity: number, purchaseWorkday = workdayId) => ({
        purchaseId: randomUUID(),
        workdayId: purchaseWorkday,
        ingredient: 'onion' as const,
        quantity,
      });

      it('adds the units to the stock and subtracts them from the purchase in flight', async () => {
        await startWith({ onion: 1 });
        const { version } = await repository.readIngredient('onion');
        await repository.registerShortage(shortage('onion', 5), version);

        expect(await repository.applyPurchase(purchase(2))).toBe('applied');

        const onion = await repository.readIngredient('onion');
        expect(onion.stock).toBe(3);
        expect(onion.demand.inFlight).toBe(3);
      });

      it('never leaves a negative purchase in flight when the market sold more', async () => {
        await startWith({});

        await repository.applyPurchase(purchase(4));

        expect((await repository.readIngredient('onion')).demand.inFlight).toBe(0);
        expect((await repository.readStock()).onion).toBe(4);
      });

      it('applies a purchase once, even when two copies arrive at the same time', async () => {
        await startWith({});
        const once = purchase(3);

        const outcomes = await Promise.all([
          repository.applyPurchase(once),
          repository.applyPurchase(once),
        ]);

        expect([...outcomes].sort()).toEqual(['applied', 'duplicate']);
        expect((await repository.readStock()).onion).toBe(3);
      });

      it('leaves out a purchase of a previous workday', async () => {
        await startWith({ onion: 1 });

        expect(await repository.applyPurchase(purchase(3, randomUUID()))).toBe('stale');
        expect((await repository.readStock()).onion).toBe(1);
      });
    });

    describe('shortages', () => {
      it('registers a shortage as pending and sets the purchase in flight', async () => {
        await startWith({});
        const { version } = await repository.readIngredient('onion');
        const onion = shortage('onion', 4);

        expect(await repository.registerShortage(onion, version)).toBe(true);

        expect((await repository.readIngredient('onion')).demand.inFlight).toBe(4);
        expect(await repository.pendingShortages('onion')).toEqual([onion]);
        expect(await repository.pendingShortages('potato')).toEqual([]);
      });

      it('refuses a shortage evaluated on a version that is no longer current', async () => {
        await startWith({});
        const { version } = await repository.readIngredient('onion');
        await repository.enqueue(waiting(0));

        expect(await repository.registerShortage(shortage('onion', 1), version)).toBe(false);
        expect(await repository.pendingShortages('onion')).toEqual([]);
      });

      it('lets only one of many concurrent evaluations register a shortage', async () => {
        await startWith({});
        const { version } = await repository.readIngredient('onion');

        const outcomes = await Promise.all(
          Array.from({ length: 10 }, () =>
            repository.registerShortage(shortage('onion', 1), version),
          ),
        );

        expect(outcomes.filter(Boolean)).toHaveLength(1);
        expect(await repository.pendingShortages('onion')).toHaveLength(1);
      });

      it('forgets a pending shortage once it is published', async () => {
        await startWith({});
        const { version } = await repository.readIngredient('onion');
        const onion = shortage('onion', 2);
        await repository.registerShortage(onion, version);

        await repository.markShortagePublished(onion.shortageId);

        expect(await repository.pendingShortages('onion')).toEqual([]);
      });
    });
  });
}
