import { INGREDIENTS, type Ingredient, type IngredientQuantity } from '@alegra-lunch/contracts';

import type {
  ReserveOutcome,
  WarehouseRepository,
  WriteOutcome,
} from '../../src/application/ports';
import type { Demand } from '../../src/domain/demand';
import { reserve } from '../../src/domain/reservation';
import type { Stock } from '../../src/domain/stock';
import type { WaitingOrder } from '../../src/domain/waiting-list';
import { stockOf } from './stock';

/**
 * In-memory adapter for the warehouse port. Node runs it on a single thread, so every
 * method is atomic, just like the conditional writes of the DynamoDB adapter.
 */
export class InMemoryWarehouse implements WarehouseRepository {
  stock: Stock = stockOf({});
  readonly demand = Object.fromEntries(
    INGREDIENTS.map((ingredient) => [ingredient, { waitingNeed: 0, inFlight: 0 }]),
  ) as Record<Ingredient, Demand>;
  private readonly startedWorkdays = new Set<string>();
  private readonly reservations = new Set<string>();
  private readonly waiting = new Map<string, WaitingOrder>();

  get waitingList(): WaitingOrder[] {
    return [...this.waiting.values()];
  }

  startWorkday(workdayId: string, stock: Stock): Promise<WriteOutcome> {
    if (this.startedWorkdays.has(workdayId)) {
      return Promise.resolve('duplicate');
    }
    this.startedWorkdays.add(workdayId);
    this.stock = { ...stock };
    return Promise.resolve('applied');
  }

  reserve(orderId: string, needs: readonly IngredientQuantity[]): Promise<ReserveOutcome> {
    if (this.reservations.has(orderId)) {
      return Promise.resolve({ status: 'duplicate' });
    }
    const result = reserve(this.stock, needs);
    if (!result.reserved) {
      return Promise.resolve({ status: 'insufficient', missing: result.missing });
    }
    this.reservations.add(orderId);
    this.stock = result.stock;
    return Promise.resolve({ status: 'reserved' });
  }

  enqueue(order: WaitingOrder): Promise<WriteOutcome> {
    if (this.waiting.has(order.orderId)) {
      return Promise.resolve('duplicate');
    }
    this.waiting.set(order.orderId, order);
    for (const { ingredient, quantity } of order.needs) {
      this.demand[ingredient].waitingNeed += quantity;
    }
    return Promise.resolve('applied');
  }
}
