import { INGREDIENTS, type Ingredient, type IngredientQuantity } from '@alegra-lunch/contracts';

import type {
  IngredientSnapshot,
  ReserveFromWaitingOutcome,
  ReserveOutcome,
  Shortage,
  WarehouseRepository,
  WriteOutcome,
} from '../../src/application/ports';
import type { Demand } from '../../src/domain/demand';
import { reserve } from '../../src/domain/reservation';
import type { Stock } from '../../src/domain/stock';
import type { WaitingOrder } from '../../src/domain/waiting-list';
import { stockOf } from './stock';

function perIngredient<T>(value: () => T): Record<Ingredient, T> {
  return Object.fromEntries(INGREDIENTS.map((ingredient) => [ingredient, value()])) as Record<
    Ingredient,
    T
  >;
}

/**
 * In-memory adapter for the warehouse port. Node runs it on a single thread, so every
 * method is atomic, just like the conditional writes of the DynamoDB adapter.
 */
export class InMemoryWarehouse implements WarehouseRepository {
  stock: Stock = stockOf({});
  readonly demand = perIngredient<Demand>(() => ({ waitingNeed: 0, inFlight: 0 }));
  /** Bumped on every write that touches the ingredient, for optimistic concurrency. */
  private readonly versions = perIngredient(() => 0);
  private readonly startedWorkdays = new Set<string>();
  private readonly reservations = new Set<string>();
  private readonly waiting = new Map<string, WaitingOrder>();
  private readonly shortages = new Map<string, Shortage & { published: boolean }>();
  /** Lets a test run something right before an order is enqueued, to simulate a race. */
  beforeEnqueue?: () => void;

  get waitingList(): WaitingOrder[] {
    return [...this.waiting.values()];
  }

  startWorkday(workdayId: string, stock: Stock): Promise<WriteOutcome> {
    if (this.startedWorkdays.has(workdayId)) {
      return Promise.resolve('duplicate');
    }
    this.startedWorkdays.add(workdayId);
    this.stock = { ...stock };
    INGREDIENTS.forEach((ingredient) => {
      this.touch(ingredient);
    });
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
    needs.forEach(({ ingredient }) => {
      this.touch(ingredient);
    });
    return Promise.resolve({ status: 'reserved' });
  }

  enqueue(order: WaitingOrder): Promise<WriteOutcome> {
    this.beforeEnqueue?.();
    if (this.waiting.has(order.orderId)) {
      return Promise.resolve('duplicate');
    }
    this.waiting.set(order.orderId, order);
    for (const { ingredient, quantity } of order.needs) {
      this.demand[ingredient].waitingNeed += quantity;
      this.touch(ingredient);
    }
    return Promise.resolve('applied');
  }

  reserveFromWaiting(order: WaitingOrder): Promise<ReserveFromWaitingOutcome> {
    if (!this.waiting.has(order.orderId)) {
      return Promise.resolve('not-waiting');
    }
    const result = reserve(this.stock, order.needs);
    if (!result.reserved) {
      return Promise.resolve('insufficient');
    }
    this.waiting.delete(order.orderId);
    this.reservations.add(order.orderId);
    this.stock = result.stock;
    for (const { ingredient, quantity } of order.needs) {
      this.demand[ingredient].waitingNeed -= quantity;
      this.touch(ingredient);
    }
    return Promise.resolve('reserved');
  }

  readIngredient(ingredient: Ingredient): Promise<IngredientSnapshot> {
    return Promise.resolve({
      stock: this.stock[ingredient],
      demand: { ...this.demand[ingredient] },
      version: this.versions[ingredient],
    });
  }

  registerShortage(shortage: Shortage, expectedVersion: number): Promise<boolean> {
    if (this.versions[shortage.ingredient] !== expectedVersion) {
      return Promise.resolve(false);
    }
    this.demand[shortage.ingredient].inFlight = shortage.quantity;
    this.shortages.set(shortage.shortageId, { ...shortage, published: false });
    this.touch(shortage.ingredient);
    return Promise.resolve(true);
  }

  pendingShortages(ingredient: Ingredient): Promise<Shortage[]> {
    return Promise.resolve(
      [...this.shortages.values()]
        .filter((shortage) => shortage.ingredient === ingredient && !shortage.published)
        .map(({ shortageId, workdayId, quantity }) => ({
          shortageId,
          workdayId,
          ingredient,
          quantity,
        })),
    );
  }

  markShortagePublished(shortageId: string): Promise<void> {
    const shortage = this.shortages.get(shortageId);
    if (shortage) {
      shortage.published = true;
    }
    return Promise.resolve();
  }

  private touch(ingredient: Ingredient): void {
    this.versions[ingredient] += 1;
  }
}
