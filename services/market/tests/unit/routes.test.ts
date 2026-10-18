import { randomUUID } from 'node:crypto';

import { createRouter } from '@alegra-lunch/shared';

import { createRoutes } from '../../src/entrypoints/http/routes';
import { InMemoryPurchases } from '../support/in-memory-purchases';

function setup() {
  const purchases = new InMemoryPurchases();
  const router = createRouter({
    routes: createRoutes({ purchases }),
    logger: { error: jest.fn() },
  });
  const get = async (query: Record<string, string>) => {
    const response = await router({
      method: 'GET',
      path: '/purchases',
      query: new URLSearchParams(query),
      headers: {},
      body: undefined,
    });
    return { status: response.status, body: JSON.parse(response.body) as unknown };
  };
  return { purchases, get };
}

describe('market API', () => {
  it('answers the purchases of a workday at GET /purchases', async () => {
    const { purchases, get } = setup();
    const workdayId = randomUUID();
    const shortageId = randomUUID();
    await purchases.startOrResume({ shortageId, workdayId, ingredient: 'onion', quantity: 2 });
    const sale = {
      purchaseId: randomUUID(),
      shortageId,
      workdayId,
      ingredient: 'onion' as const,
      quantity: 3,
    };
    await purchases.recordSale(sale, { requested: 2, bought: 3, failedAttempts: 0 });

    const { status, body } = await get({ workdayId });

    expect(status).toBe(200);
    expect(body).toEqual({ workdayId, purchases: [sale] });
  });

  it.each<Record<string, string>>([{}, { workdayId: 'yesterday' }])(
    'answers 400 without a valid workday id: %j',
    async (query) => {
      expect((await setup().get(query)).status).toBe(400);
    },
  );
});
