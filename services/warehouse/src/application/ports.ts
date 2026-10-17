import type {
  DomainEvent,
  EventPayload,
  Ingredient,
  IngredientQuantity,
} from '@alegra-lunch/contracts';

import type { Demand } from '../domain/demand';
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

/** 'not-waiting' means another process already took the order out of the waiting list. */
export type ReserveFromWaitingOutcome = 'reserved' | 'insufficient' | 'not-waiting';

/** Current state of one ingredient, with the version used for optimistic concurrency. */
export interface IngredientSnapshot {
  stock: number;
  demand: Demand;
  version: number;
}

/** Units the market sold in one call. */
export type Purchase = Pick<
  EventPayload<'IngredientPurchased'>,
  'purchaseId' | 'ingredient' | 'quantity'
>;

/** A reservation made from the waiting list that the kitchen has not been told about yet. */
export type PendingReservation = EventPayload<'IngredientsReserved'>;

/** A purchase request to the market, kept as pending until it is published (§3.5). */
export type Shortage = EventPayload<'StockShortage'>;

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

  /**
   * Reserves a waiting order and, in the same transaction, takes it out of the waiting list,
   * subtracts its need from the demand and records the reservation as pending to publish.
   * Only one process can take out the same order.
   */
  reserveFromWaiting(order: WaitingOrder): Promise<ReserveFromWaitingOutcome>;

  waitingOrders(): Promise<WaitingOrder[]>;

  pendingReservations(): Promise<PendingReservation[]>;

  markReservationPublished(orderId: string): Promise<void>;

  readStock(): Promise<Stock>;

  /**
   * Adds the units to the stock and subtracts them from the in-flight purchase, without going
   * below 0 (the rest are leftovers). Applied at most once per purchase (§3.5).
   */
  applyPurchase(purchase: Purchase): Promise<WriteOutcome>;

  readIngredient(ingredient: Ingredient): Promise<IngredientSnapshot>;

  /**
   * Only if the ingredient is still at `expectedVersion`: sets its in-flight units to the
   * shortage quantity and records the shortage as pending, in the same write.
   * Returns false when another write got there first.
   */
  registerShortage(shortage: Shortage, expectedVersion: number): Promise<boolean>;

  /** Shortages of the ingredient that were registered but not yet published. */
  pendingShortages(ingredient: Ingredient): Promise<Shortage[]>;

  markShortagePublished(shortageId: string): Promise<void>;
}

/** Publishes events to the other services. */
export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
}
