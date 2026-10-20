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
    /** The click of the button the dish was ordered in. */
    batchId?: string;
    placedAt?: string;
    deliveredAt?: string;
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

/** The latest batches the model reads in detail; the slowest and quickest cover all of them. */
const MAX_BATCHES = 50;

/** A batch whose time has not arrived yet goes last, as on the dashboard. */
const timeOf = (placedAt: string | undefined) => (placedAt ? Date.parse(placedAt) : Infinity);

/** The time in Bogotá, as the manager reads it on the dashboard. */
const bogotaTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Bogota',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

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

  const batches = [...Map.groupBy(snapshot.orders, ({ batchId }) => batchId)]
    .map(([, orders]) => {
      const placedAt = orders.find((order) => order.placedAt)?.placedAt;
      const delivered = orders.filter(({ status }) => status === 'DELIVERED');
      const lastDelivery = Math.max(
        ...delivered.map(({ deliveredAt }) => Date.parse(deliveredAt ?? '')),
      );
      return {
        placedAt,
        dishes: orders.length,
        delivered: delivered.length,
        // Only once every dish is out, like the "Took" column of the order history.
        tookSeconds:
          placedAt && delivered.length === orders.length && Number.isFinite(lastDelivery)
            ? Math.round((lastDelivery - Date.parse(placedAt)) / 1_000)
            : undefined,
      };
    })
    // Numbered by the time they were placed, as the order history numbers them.
    .sort((a, b) => timeOf(a.placedAt) - timeOf(b.placedAt))
    .map(({ placedAt, ...batch }, index) => ({
      batch: index + 1,
      placedAt: placedAt ? bogotaTime.format(new Date(placedAt)) : undefined,
      ...batch,
    }));
  const finished = batches.filter(({ tookSeconds }) => tookSeconds !== undefined);
  const byDuration = finished.toSorted((a, b) => (a.tookSeconds ?? 0) - (b.tookSeconds ?? 0));

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
    batchesTotal: batches.length,
    batches: batches.slice(-MAX_BATCHES),
    slowestBatch: byDuration.at(-1),
    quickestBatch: byDuration.at(0),
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
