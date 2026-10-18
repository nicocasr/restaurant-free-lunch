import type { DomainEvent } from '@alegra-lunch/contracts';

import type { OrderStatus } from '../domain/order-status';

/** One dish of a batch, as shown in the order history (read model). */
export interface OrderRecord {
  orderId: string;
  batchId: string;
  workdayId: string;
  status: OrderStatus;
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

  /**
   * Stores the batch only if its key is new, and returns the one that is stored: a repeated
   * request gets the orders of the first attempt (PLANNING §3.6).
   */
  createBatch(batch: Batch): Promise<Batch>;

  /** Writes each order only if it does not exist yet, so a status that moved on is kept. */
  saveNewOrders(orders: readonly OrderRecord[]): Promise<void>;
}

/** Publishes events to the other services. */
export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
}
