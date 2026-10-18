import { randomUUID } from 'node:crypto';

import { InMemoryPublisher } from '@alegra-lunch/testing';

import {
  WorkdayInProgressError,
  seedFirstWorkday,
  startWorkday,
} from '../../src/application/start-workday';
import type { OrderRecord } from '../../src/application/ports';
import { InMemoryOrders } from '../support/in-memory-orders';

function setup() {
  const orders = new InMemoryOrders();
  const publisher = new InMemoryPublisher();
  return { orders, publisher, handle: startWorkday({ orders, publisher }) };
}

function announced(publisher: InMemoryPublisher): string[] {
  return publisher.ofType('WorkdayStarted').map(({ payload }) => payload.workdayId);
}

async function addOrder(orders: InMemoryOrders, workdayId: string, status: OrderRecord['status']) {
  const order = { orderId: randomUUID(), batchId: randomUUID(), workdayId, status };
  await orders.saveNewOrders([order]);
}

describe('startWorkday', () => {
  it('starts a new workday and tells the warehouse, when no order is in progress', async () => {
    const { orders, publisher, handle } = setup();
    const previous = randomUUID();
    orders.activeWorkdayId = previous;
    await addOrder(orders, previous, 'DELIVERED');

    const { workdayId } = await handle();

    expect(workdayId).not.toBe(previous);
    expect(orders.activeWorkdayId).toBe(workdayId);
    expect(announced(publisher)).toEqual([workdayId]);
  });

  it('refuses while orders are in progress and tells how many are left', async () => {
    const { orders, publisher, handle } = setup();
    const current = randomUUID();
    orders.activeWorkdayId = current;
    await addOrder(orders, current, 'WAITING_INGREDIENTS');
    await addOrder(orders, current, 'PREPARING');
    await addOrder(orders, current, 'DELIVERED');

    const attempt = handle();

    await expect(attempt).rejects.toThrow(WorkdayInProgressError);
    await expect(attempt).rejects.toThrow(/2/);
    expect(orders.activeWorkdayId).toBe(current);
    expect(publisher.events).toEqual([]);
  });

  it('ignores orders of previous workdays', async () => {
    const { orders, handle } = setup();
    orders.activeWorkdayId = randomUUID();
    await addOrder(orders, randomUUID(), 'PLACED');

    await expect(handle()).resolves.toEqual({ workdayId: expect.any(String) as string });
  });

  it('starts a single workday when the manager clicks twice at the same time', async () => {
    const { orders, publisher, handle } = setup();
    orders.activeWorkdayId = randomUUID();

    const [first, second] = await Promise.all([handle(), handle()]);

    expect(second).toEqual(first);
    expect(orders.activeWorkdayId).toBe(first.workdayId);
    expect(announced(publisher)).toEqual([first.workdayId]);
  });

  it('announces a workday the previous attempt switched to but died before announcing', async () => {
    const { orders, publisher, handle } = setup();
    orders.activeWorkdayId = randomUUID();
    publisher.failNext('WorkdayStarted');

    await expect(handle()).rejects.toThrow('Simulated failure');
    const unannounced = orders.activeWorkdayId;
    await handle();

    expect(announced(publisher)[0]).toBe(unannounced);
  });
});

describe('seedFirstWorkday', () => {
  it('creates and announces the first workday when there is none', async () => {
    const orders = new InMemoryOrders();
    const publisher = new InMemoryPublisher();

    const { workdayId } = await seedFirstWorkday({ orders, publisher })();

    expect(orders.activeWorkdayId).toBe(workdayId);
    expect(announced(publisher)).toEqual([workdayId]);
  });

  it('keeps the active workday on every later start of the service', async () => {
    const orders = new InMemoryOrders();
    const publisher = new InMemoryPublisher();
    const seed = seedFirstWorkday({ orders, publisher });

    const first = await seed();
    const second = await seed();

    expect(second).toEqual(first);
    expect(announced(publisher)).toEqual([first.workdayId]);
  });
});
