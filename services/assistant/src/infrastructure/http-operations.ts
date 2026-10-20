import { IngredientQuantitySchema, IngredientSchema } from '@alegra-lunch/contracts';
import { z } from 'zod';

import type { OperationsSource } from '../application/ports';
import type { Snapshot } from '../domain/summarize';

// Only the fields the assistant reads; loose objects keep the rest (tolerant reader, §3.2).
const OrdersSchema = z.looseObject({
  workdayId: z.string().optional(),
  orders: z.array(
    z.looseObject({
      orderId: z.string(),
      status: z.string(),
      recipeName: z.string().optional(),
      missing: z.array(IngredientQuantitySchema).optional(),
      waitingSince: z.string().optional(),
    }),
  ),
});

const InventorySchema = z.looseObject({
  ingredients: z.array(
    z.looseObject({
      ingredient: IngredientSchema,
      stock: z.number(),
      waitingNeed: z.number(),
      inFlight: z.number(),
    }),
  ),
});

const PurchasesSchema = z.looseObject({
  purchases: z.array(z.looseObject({ ingredient: IngredientSchema, quantity: z.number() })),
});

const RecipesSchema = z.array(
  z.looseObject({ name: z.string(), ingredients: z.array(IngredientQuantitySchema) }),
);

/**
 * Reads the workday from the query API of each service that owns the data, the same ones the
 * dashboard uses (PLANNING §2): the assistant never reads another service's table.
 */
export class HttpOperations implements OperationsSource {
  private readonly urls: { orders: string; warehouse: string; market: string; kitchen: string };
  private readonly timeoutMs: number;

  constructor(deps: {
    urls: { orders: string; warehouse: string; market: string; kitchen: string };
    timeoutMs: number;
  }) {
    this.urls = deps.urls;
    this.timeoutMs = deps.timeoutMs;
  }

  async read(): Promise<Snapshot> {
    const [{ workdayId, orders }, { ingredients }, recipes] = await Promise.all([
      this.get(`${this.urls.orders}/orders`, OrdersSchema),
      this.get(`${this.urls.warehouse}/inventory`, InventorySchema),
      this.get(`${this.urls.kitchen}/recipes`, RecipesSchema),
    ]);
    const { purchases } = workdayId
      ? await this.get(`${this.urls.market}/purchases?workdayId=${workdayId}`, PurchasesSchema)
      : { purchases: [] };

    return { workdayId, orders, inventory: ingredients, purchases, recipes };
  }

  private async get<T>(url: string, schema: z.ZodType<T>): Promise<T> {
    const response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) {
      throw new Error(`GET ${url} answered ${String(response.status)}`);
    }
    return schema.parse(await response.json());
  }
}
