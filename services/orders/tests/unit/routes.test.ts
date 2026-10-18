import { randomUUID } from 'node:crypto';

import { createRouter, type HttpRequest } from '@alegra-lunch/shared';
import { InMemoryPublisher } from '@alegra-lunch/testing';

import { createRoutes, statusFor } from '../../src/entrypoints/http/routes';
import { InMemoryOrders } from '../support/in-memory-orders';

function setup() {
  const orders = new InMemoryOrders();
  const workdayId = randomUUID();
  orders.activeWorkdayId = workdayId;
  const router = createRouter({
    routes: createRoutes({ orders, publisher: new InMemoryPublisher(), maxQuantity: 50 }),
    statusFor,
    logger: { error: jest.fn() },
  });
  const call = async (request: Partial<HttpRequest>) => {
    const response = await router({
      method: 'GET',
      path: '/',
      query: new URLSearchParams(),
      headers: {},
      body: undefined,
      ...request,
    });
    return { status: response.status, body: JSON.parse(response.body || 'null') as unknown };
  };
  return { orders, workdayId, call };
}

const placing = (quantity: unknown, key: string | undefined = randomUUID()) => ({
  method: 'POST',
  path: '/orders',
  headers: { 'idempotency-key': key },
  body: JSON.stringify({ quantity }),
});

describe('orders API', () => {
  it('accepts a batch with 202 and answers its order ids', async () => {
    const { workdayId, call } = setup();

    const { status, body } = await call(placing(3));

    expect(status).toBe(202);
    expect(body).toMatchObject({ workdayId, orderIds: expect.any(Array) as unknown[] });
  });

  it.each([
    ['without an Idempotency-Key', { ...placing(3), headers: {} }],
    ['with an Idempotency-Key that is not a UUID', placing(3, 'click-1')],
    ['above the maximum', placing(51)],
    ['with a quantity that is not a number', placing('3')],
  ])('answers 400 to a batch %s', async (_, request) => {
    const { call } = setup();

    expect((await call(request)).status).toBe(400);
  });

  it('starts a workday with 201, and answers 409 while orders are in progress', async () => {
    const { call } = setup();

    expect((await call({ method: 'POST', path: '/workdays' })).status).toBe(201);
    await call(placing(1));
    const conflict = await call({ method: 'POST', path: '/workdays' });

    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual({
      error: expect.stringContaining('1 still in progress') as string,
    });
  });

  it('answers the active workday and its orders', async () => {
    const { workdayId, call } = setup();
    await call(placing(2));

    const active = await call({ path: '/workdays/active' });
    const history = await call({ path: '/orders' });

    expect(active.body).toEqual({ workdayId });
    expect(history.body).toMatchObject({ workdayId });
    expect((history.body as { orders: unknown[] }).orders).toHaveLength(2);
  });

  it('answers the orders of a previous workday when asked for it', async () => {
    const { call } = setup();
    const previous = randomUUID();

    const history = await call({
      path: '/orders',
      query: new URLSearchParams({ workdayId: previous }),
    });

    expect(history.body).toEqual({ workdayId: previous, orders: [] });
  });

  it('answers an empty history when no workday exists yet', async () => {
    const { orders, call } = setup();
    orders.activeWorkdayId = undefined;

    expect((await call({ path: '/orders' })).body).toEqual({ orders: [] });
  });
});
