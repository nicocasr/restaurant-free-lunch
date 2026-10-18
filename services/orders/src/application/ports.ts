import type { DomainEvent, IngredientQuantity } from '@alegra-lunch/contracts';

import type { OrderStatus } from '../domain/order-status';

/** One dish of a batch, as shown in the order history (read model). */
export interface OrderRecord {
  orderId: string;
  batchId: string;
  workdayId: string;
  status: OrderStatus;
  recipeId?: string;
  recipeName?: string;
  /** What the order lacked when it joined the warehouse waiting list. */
  missing?: IngredientQuantity[];
  /** ISO timestamp of when the order started waiting for ingredients. */
  waitingSince?: string;
}

/** What locates an order: its id and the workday it belongs to. */
export type OrderKey = Pick<OrderRecord, 'orderId' | 'workdayId'>;

/** A change to an order, coming from one event of the other services. */
export interface OrderUpdate {
  status: OrderStatus;
  recipe?: { recipeId: string; recipeName: string };
  waiting?: { missing: IngredientQuantity[]; since: string };
}

/** A click of the manager: its Idempotency-Key and the ids of the orders it created. */
export interface Batch {
  batchId: string;
  workdayId: string;
  orderIds: string[];
}

/** Persistence port of the orders service. Every method is atomic. */
export interface OrdersRepository {
  activeWorkday(): Promise<string | undefined>;

  /** Orders of the workday that are not delivered yet. */
  countInProgress(workdayId: string): Promise<number>;

  /**
   * Only if the active workday is still `from`: makes `to` the active one and records it as
   * pending to announce, in the same write. Returns false when another request got there first.
   */
  switchWorkday(from: string | undefined, to: string): Promise<boolean>;

  /** Workdays that became active but whose WorkdayStarted was not published yet. */
  pendingWorkdays(): Promise<string[]>;

  markWorkdayAnnounced(workdayId: string): Promise<void>;

  /**
   * Stores the batch only if its key is new, and returns the one that is stored: a repeated
   * request gets the orders of the first attempt (PLANNING §3.6).
   */
  createBatch(batch: Batch): Promise<Batch>;

  /** Writes each order only if it does not exist yet, so a status that moved on is kept. */
  saveNewOrders(orders: readonly OrderRecord[]): Promise<void>;

  /**
   * The recipe is kept whenever it arrives, since events may come in any order. The status
   * only moves forward (PLANNING §3.6), and the waiting details are kept only when the order
   * actually moves to WAITING_INGREDIENTS.
   */
  updateOrder(order: OrderKey, update: OrderUpdate): Promise<void>;

  /** The order history of a workday, for the dashboard. */
  listOrders(workdayId: string): Promise<OrderRecord[]>;
}

/** Publishes events to the other services. */
export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
}
