import type {
  Batch,
  OrderRecord,
  OrdersRepository,
  OrderUpdate,
} from '../../src/application/ports';
import { advance, isInProgress } from '../../src/domain/order-status';

/**
 * In-memory adapter for the orders port. Node runs it on a single thread, so every method is
 * atomic, just like the conditional writes of the DynamoDB adapter.
 */
export class InMemoryOrders implements OrdersRepository {
  activeWorkdayId?: string;
  private readonly batches = new Map<string, Batch>();
  private readonly orders = new Map<string, OrderRecord>();
  private readonly unannounced = new Set<string>();

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

  updateOrder(orderId: string, { status, recipe, waiting }: OrderUpdate): Promise<void> {
    const order = this.orders.get(orderId);
    if (order) {
      const moved = advance(order.status, status) !== order.status;
      this.orders.set(orderId, {
        ...order,
        ...recipe,
        ...(moved && { status }),
        ...(moved && waiting && { missing: waiting.missing, waitingSince: waiting.since }),
      });
    }
    return Promise.resolve();
  }

  countInProgress(workdayId: string): Promise<number> {
    return Promise.resolve(
      this.allOrders.filter((order) => order.workdayId === workdayId && isInProgress(order.status))
        .length,
    );
  }

  switchWorkday(from: string | undefined, to: string): Promise<boolean> {
    if (this.activeWorkdayId !== from) {
      return Promise.resolve(false);
    }
    this.activeWorkdayId = to;
    this.unannounced.add(to);
    return Promise.resolve(true);
  }

  pendingWorkdays(): Promise<string[]> {
    return Promise.resolve([...this.unannounced]);
  }

  markWorkdayAnnounced(workdayId: string): Promise<void> {
    this.unannounced.delete(workdayId);
    return Promise.resolve();
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
