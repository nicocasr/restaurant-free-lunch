import type { Batch, OrderRecord, OrdersRepository } from '../../src/application/ports';

/**
 * In-memory adapter for the orders port. Node runs it on a single thread, so every method is
 * atomic, just like the conditional writes of the DynamoDB adapter.
 */
export class InMemoryOrders implements OrdersRepository {
  activeWorkdayId?: string;
  private readonly batches = new Map<string, Batch>();
  private readonly orders = new Map<string, OrderRecord>();

  get allOrders(): OrderRecord[] {
    return [...this.orders.values()];
  }

  /** Lets a test move an order forward, as the events of the other services would. */
  setStatus(orderId: string, status: OrderRecord['status']): void {
    const order = this.orders.get(orderId);
    if (order) {
      this.orders.set(orderId, { ...order, status });
    }
  }

  activeWorkday(): Promise<string | undefined> {
    return Promise.resolve(this.activeWorkdayId);
  }

  createBatch(batch: Batch): Promise<Batch> {
    const existing = this.batches.get(batch.batchId);
    if (existing) {
      return Promise.resolve(existing);
    }
    this.batches.set(batch.batchId, batch);
    return Promise.resolve(batch);
  }

  saveNewOrders(orders: readonly OrderRecord[]): Promise<void> {
    for (const order of orders) {
      if (!this.orders.has(order.orderId)) {
        this.orders.set(order.orderId, order);
      }
    }
    return Promise.resolve();
  }
}
