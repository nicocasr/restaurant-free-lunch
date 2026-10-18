import { randomUUID } from 'node:crypto';

import { createEvent } from '@alegra-lunch/contracts';

import type { Batch, EventPublisher, OrdersRepository } from './ports';

export interface PlaceOrdersRequest {
  idempotencyKey: string;
  quantity: number;
}

/**
 * Handles POST /orders: the manager asks for a number of dishes (R1). The order ids are fixed
 * inside the batch first, so the orders can be written in several steps and a retry with the
 * same key completes them without duplicates (PLANNING §3.6).
 */
export function placeOrders(deps: {
  orders: OrdersRepository;
  publisher: EventPublisher;
  maxQuantity: number;
}) {
  return async ({ idempotencyKey, quantity }: PlaceOrdersRequest): Promise<Batch> => {
    const workdayId = await deps.orders.activeWorkday();
    if (!workdayId) {
      throw new Error('There is no active workday to place orders in');
    }

    const batch = await deps.orders.createBatch({
      batchId: idempotencyKey,
      workdayId,
      orderIds: Array.from({ length: quantity }, () => randomUUID()),
    });

    await deps.orders.saveNewOrders(
      batch.orderIds.map((orderId) => ({
        orderId,
        batchId: batch.batchId,
        workdayId: batch.workdayId,
        status: 'PLACED' as const,
      })),
    );

    // Each dish is traced end to end by its own order id.
    for (const orderId of batch.orderIds) {
      await deps.publisher.publish(
        createEvent(
          'OrderPlaced',
          { orderId, workdayId: batch.workdayId },
          { correlationId: orderId },
        ),
      );
    }
    return batch;
  };
}
