import type { Route } from '@alegra-lunch/shared';

import { getInventory } from '../../application/get-inventory';
import type { WarehouseRepository } from '../../application/ports';

/** The query API of the warehouse, for the dashboard (PLANNING §2). */
export function createRoutes(deps: { warehouse: WarehouseRepository }): Route[] {
  const inventory = getInventory(deps);
  return [
    {
      method: 'GET',
      path: '/inventory',
      handle: async () => ({ status: 200, body: await inventory() }),
    },
  ];
}
