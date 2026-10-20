import { INGREDIENTS, type Ingredient } from '@alegra-lunch/contracts';

import type { WarehouseRepository } from './ports';

interface Inventory {
  workdayId: string | undefined;
  ingredients: { ingredient: Ingredient; stock: number; waitingNeed: number; inFlight: number }[];
  waitingOrders: number;
}

/** GET /inventory: what the dashboard shows of the warehouse (PLANNING §2). */
export function getInventory(deps: { warehouse: WarehouseRepository }) {
  return async (): Promise<Inventory> => {
    const [workdayId, snapshots, waiting] = await Promise.all([
      deps.warehouse.activeWorkday(),
      Promise.all(INGREDIENTS.map((ingredient) => deps.warehouse.readIngredient(ingredient))),
      deps.warehouse.waitingOrders(),
    ]);
    return {
      workdayId,
      ingredients: snapshots.map(({ stock, demand }, index) => ({
        ingredient: INGREDIENTS[index] as Ingredient,
        stock,
        ...demand,
      })),
      waitingOrders: waiting.length,
    };
  };
}
