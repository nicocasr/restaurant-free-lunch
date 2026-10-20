import type { Route } from '@alegra-lunch/shared';
import { z } from 'zod';

import { InvalidOrderRequestError, placeOrders } from '../../application/place-orders';
import type { EventPublisher, OrdersRepository } from '../../application/ports';
import { WorkdayInProgressError, startWorkday } from '../../application/start-workday';

const IdempotencyKeySchema = z.uuid();

/** The errors the manager can cause, with the status the API answers (PLANNING §3.5). */
export function statusFor(error: Error): number | undefined {
  if (error instanceof InvalidOrderRequestError) return 400;
  if (error instanceof WorkdayInProgressError) return 409;
  return undefined;
}

/** The manager API (PLANNING §3.2): place dishes, start a workday and read the history. */
export function createRoutes(deps: {
  orders: OrdersRepository;
  publisher: EventPublisher;
  maxQuantity: number;
}): Route[] {
  const place = placeOrders(deps);
  const newWorkday = startWorkday(deps);

  return [
    {
      method: 'POST',
      path: '/orders',
      handle: async ({ body, headers }) => {
        const idempotencyKey = headers['idempotency-key'];
        if (!IdempotencyKeySchema.safeParse(idempotencyKey).success) {
          throw new InvalidOrderRequestError('The Idempotency-Key header must be a UUID');
        }
        const { quantity } = (body ?? {}) as { quantity?: unknown };
        // placeOrders validates the quantity against the contract and the configured maximum.
        const batch = await place({
          idempotencyKey: idempotencyKey as string,
          quantity: quantity as number,
        });
        // 202: the dishes are on their way; their progress arrives through the dashboard.
        return { status: 202, body: batch };
      },
    },
    {
      method: 'POST',
      path: '/workdays',
      handle: async () => ({ status: 201, body: await newWorkday() }),
    },
    {
      method: 'GET',
      path: '/workdays/active',
      handle: async () => ({ status: 200, body: { workdayId: await deps.orders.activeWorkday() } }),
    },
    {
      method: 'GET',
      path: '/orders',
      handle: async ({ query }) => {
        const workdayId = query.get('workdayId') ?? (await deps.orders.activeWorkday());
        const orders = workdayId ? await deps.orders.listOrders(workdayId) : [];
        return { status: 200, body: { workdayId, orders } };
      },
    },
  ];
}
