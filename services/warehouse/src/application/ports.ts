import type { DomainEvent, IngredientQuantity } from '@alegra-lunch/contracts';

import type { Stock } from '../domain/stock';
import type { WaitingOrder } from '../domain/waiting-list';

/**
 * Result of a conditional write. 'duplicate' means the same message was already applied:
 * the database is the arbiter of idempotency (PLANNING §3.6).
 */
export type WriteOutcome = 'applied' | 'duplicate';

export type ReserveOutcome =
  | { status: 'reserved' }
  /** The order was already reserved by an earlier delivery of the same message. */
  | { status: 'duplicate' }
  | { status: 'insufficient'; missing: IngredientQuantity[] };

/** Persistence port of the warehouse. Every method is atomic. */
export interface WarehouseRepository {
  /** Replaces the whole stock, at most once per workday. */
  startWorkday(workdayId: string, stock: Stock): Promise<WriteOutcome>;

  /**
   * Deducts every ingredient of the order, or nothing and reports what is missing (§3.5).
   * An order is reserved at most once, even when its stock has run out since.
   */
  reserve(orderId: string, needs: readonly IngredientQuantity[]): Promise<ReserveOutcome>;

  /**
   * Adds the order to the waiting list and, in the same write, its need of every one of
   * its ingredients to the aggregated demand (§3.5). An order is listed at most once.
   */
  enqueue(order: WaitingOrder): Promise<WriteOutcome>;
}

/** Publishes events to the other services. */
export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
}
