import { createRouter } from '@alegra-lunch/shared';

import { createRoutes } from '../../src/entrypoints/http/routes';
import { InMemoryWarehouse } from '../support/in-memory-warehouse';

describe('warehouse API', () => {
  it('answers the inventory at GET /inventory', async () => {
    const router = createRouter({
      routes: createRoutes({ warehouse: new InMemoryWarehouse() }),
      logger: { error: jest.fn() },
    });

    const response = await router({
      method: 'GET',
      path: '/inventory',
      query: new URLSearchParams(),
      headers: {},
      body: undefined,
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ waitingOrders: 0 });
  });
});
