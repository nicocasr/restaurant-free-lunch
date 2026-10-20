import type { Ingredient, IngredientQuantity } from '@alegra-lunch/contracts';

/** What the services answer about the workday, as their query APIs return it. */
export interface Snapshot {
  workdayId: string | undefined;
  orders: readonly {
    orderId: string;
    status: string;
    recipeName?: string;
    missing?: readonly IngredientQuantity[];
    waitingSince?: string;
  }[];
  inventory: readonly {
    ingredient: Ingredient;
    stock: number;
    waitingNeed: number;
    inFlight: number;
  }[];
  purchases: readonly { ingredient: Ingredient; quantity: number }[];
  recipes: readonly { name: string; ingredients: readonly IngredientQuantity[] }[];
}

/** The model reads the oldest waiting orders; more would only cost tokens. */
const MAX_WAITING_ORDERS = 20;

const listOf = (items: readonly IngredientQuantity[]) =>
  items.map(({ ingredient, quantity }) => `${ingredient} x${String(quantity)}`).join(', ');

/**
 * The workday in a few hundred tokens (PLANNING §5): counts instead of every order, so a
 * question costs one small call to Gemini however many dishes were ordered.
 */
export function summarize(snapshot: Snapshot, now: Date) {
  const byStatus: Record<string, number> = {};
  const deliveredByDish: Record<string, number> = {};
  for (const { status, recipeName } of snapshot.orders) {
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (status === 'DELIVERED' && recipeName) {
      deliveredByDish[recipeName] = (deliveredByDish[recipeName] ?? 0) + 1;
    }
  }

  const waiting = snapshot.orders
    .filter(({ status }) => status === 'WAITING_INGREDIENTS')
    .map((order) => ({
      order: order.orderId.slice(0, 7),
      dish: order.recipeName,
      missing: listOf(order.missing ?? []),
      waitingSeconds: order.waitingSince
        ? Math.round((now.getTime() - Date.parse(order.waitingSince)) / 1_000)
        : undefined,
    }))
    .sort((a, b) => (b.waitingSeconds ?? 0) - (a.waitingSeconds ?? 0));

  const bought = new Map<Ingredient, { purchases: number; units: number }>();
  for (const { ingredient, quantity } of snapshot.purchases) {
    const total = bought.get(ingredient) ?? { purchases: 0, units: 0 };
    bought.set(ingredient, { purchases: total.purchases + 1, units: total.units + quantity });
  }

  return {
    workdayId: snapshot.workdayId,
    orders: {
      total: snapshot.orders.length,
      byStatus,
      deliveredByDish,
      waitingTotal: waiting.length,
      waiting: waiting.slice(0, MAX_WAITING_ORDERS),
    },
    inventory: snapshot.inventory.map(({ ingredient, stock, inFlight, waitingNeed }) => ({
      ingredient,
      stock,
      onItsWay: inFlight,
      neededByWaitingOrders: waitingNeed,
    })),
    purchases: {
      purchases: snapshot.purchases.length,
      units: snapshot.purchases.reduce((sum, { quantity }) => sum + quantity, 0),
      byIngredient: [...bought]
        .map(([ingredient, total]) => ({ ingredient, ...total }))
        .sort((a, b) => b.units - a.units),
    },
    recipes: snapshot.recipes.map(({ name, ingredients }) => ({
      dish: name,
      ingredients: listOf(ingredients),
    })),
  };
}

export type Summary = ReturnType<typeof summarize>;
