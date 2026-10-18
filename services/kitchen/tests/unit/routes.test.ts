import { createRouter } from '@alegra-lunch/shared';

import { MENU } from '../../src/domain/menu';
import { createRoutes } from '../../src/entrypoints/http/routes';

describe('kitchen API', () => {
  it('answers the menu at GET /recipes', async () => {
    const router = createRouter({ routes: createRoutes(), logger: { error: jest.fn() } });

    const response = await router({
      method: 'GET',
      path: '/recipes',
      query: new URLSearchParams(),
      headers: {},
      body: undefined,
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual(MENU);
  });
});
