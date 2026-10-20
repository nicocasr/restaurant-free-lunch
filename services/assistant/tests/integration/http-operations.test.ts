import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { HttpOperations } from '../../src/infrastructure/http-operations';

/** The query APIs of the services, faked by path on one local server. */
async function fakeServices(routes: Record<string, { status?: number; body: unknown }>) {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    const url = request.url ?? '';
    asked.push(url);
    const route = routes[url];
    response.writeHead(route?.status ?? (route ? 200 : 404), {
      'content-type': 'application/json',
    });
    response.end(JSON.stringify(route?.body ?? {}));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${String(port)}`;
  const operations = new HttpOperations({
    urls: { orders: url, warehouse: url, market: url, kitchen: url },
    timeoutMs: 1_000,
  });
  return { server, asked, operations };
}

const INVENTORY = {
  workdayId: 'workday-1',
  ingredients: [{ ingredient: 'onion', stock: 2, waitingNeed: 1, inFlight: 3 }],
  waitingOrders: 1,
};
const RECIPES = [
  { id: 'changua', name: 'Changua con queso', ingredients: [{ ingredient: 'onion', quantity: 1 }] },
];

describe('HttpOperations', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
    server = undefined;
  });

  it('reads the workday from the query API of each service', async () => {
    const fake = await fakeServices({
      '/orders': {
        body: {
          workdayId: 'workday-1',
          orders: [
            { orderId: 'a', status: 'DELIVERED', recipeName: 'Changua con queso', batchId: 'b' },
          ],
        },
      },
      '/inventory': { body: INVENTORY },
      '/recipes': { body: RECIPES },
      '/purchases?workdayId=workday-1': {
        body: {
          workdayId: 'workday-1',
          purchases: [{ ingredient: 'onion', quantity: 4, purchaseId: 'p' }],
        },
      },
    });
    server = fake.server;

    const snapshot = await fake.operations.read();

    expect(snapshot.workdayId).toBe('workday-1');
    expect(snapshot.orders).toEqual([
      expect.objectContaining({
        orderId: 'a',
        status: 'DELIVERED',
        recipeName: 'Changua con queso',
      }),
    ]);
    expect(snapshot.inventory).toEqual([
      expect.objectContaining({ ingredient: 'onion', stock: 2, waitingNeed: 1, inFlight: 3 }),
    ]);
    expect(snapshot.purchases).toEqual([
      expect.objectContaining({ ingredient: 'onion', quantity: 4 }),
    ]);
    expect(snapshot.recipes).toEqual([expect.objectContaining({ name: 'Changua con queso' })]);
  });

  it('asks for no purchases before the first workday', async () => {
    const fake = await fakeServices({
      '/orders': { body: { orders: [] } },
      '/inventory': { body: { ingredients: [], waitingOrders: 0 } },
      '/recipes': { body: RECIPES },
    });
    server = fake.server;

    const snapshot = await fake.operations.read();

    expect(snapshot.purchases).toEqual([]);
    expect(fake.asked.some((url) => url.startsWith('/purchases'))).toBe(false);
  });

  it('fails when a service does not answer, instead of answering with partial data', async () => {
    const fake = await fakeServices({
      '/orders': { body: { workdayId: 'workday-1', orders: [] } },
      '/inventory': { status: 503, body: { error: 'down' } },
      '/recipes': { body: RECIPES },
    });
    server = fake.server;

    await expect(fake.operations.read()).rejects.toThrow('/inventory answered 503');
  });
});
