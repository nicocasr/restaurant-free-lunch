import type { Ingredient, IngredientQuantity } from '@alegra-lunch/contracts';

import { config } from './config';
import type { OrderView, Purchase } from './state/dashboard';

export interface Recipe {
  id: string;
  name: string;
  ingredients: IngredientQuantity[];
}

export interface InventoryLine {
  ingredient: Ingredient;
  stock: number;
  waitingNeed: number;
  inFlight: number;
}

export interface Inventory {
  workdayId: string | undefined;
  ingredients: InventoryLine[];
  waitingOrders: number;
}

/** An answer the API gives on purpose, like 409 while orders are in progress. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body.error ?? `The service answered ${String(response.status)}`,
    );
  }
  return body as T;
}

export const api = {
  activeWorkday: () =>
    request<{ workdayId: string | undefined }>(`${config.ordersUrl}/workdays/active`),

  orders: (workdayId?: string) =>
    request<{ workdayId: string | undefined; orders: OrderView[] }>(
      `${config.ordersUrl}/orders${workdayId ? `?workdayId=${workdayId}` : ''}`,
    ),

  /** The key makes a double click or a retry place the batch only once (PLANNING §3.6). */
  placeOrders: (quantity: number, idempotencyKey: string) =>
    request<{ batchId: string; orderIds: string[] }>(`${config.ordersUrl}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ quantity }),
    }),

  startWorkday: () =>
    request<{ workdayId: string }>(`${config.ordersUrl}/workdays`, { method: 'POST' }),

  inventory: () => request<Inventory>(`${config.warehouseUrl}/inventory`),

  purchases: (workdayId: string) =>
    request<{ purchases: Purchase[] }>(`${config.marketUrl}/purchases?workdayId=${workdayId}`),

  recipes: () => request<Recipe[]>(`${config.kitchenUrl}/recipes`),
};
