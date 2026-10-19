import type { DomainEvent } from '@alegra-lunch/contracts';
import { createEventPublisher } from '@alegra-lunch/shared';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';

import { seedFirstWorkday } from '../application/start-workday';
import { trackOrder } from '../application/track-order';
import { DynamoOrders } from '../infrastructure/dynamo-orders';
import { createRoutes } from './http/routes';

/** Variables of orders in both runtimes. */
export const ordersConfig = {
  TABLE_NAME: z.string().min(1),
  MAX_ORDER_QUANTITY: z.coerce.number().int().positive().default(1_000),
};

/** The real adapters connected to the use cases, shared by the container and Lambda. */
export function wire(config: {
  TABLE_NAME: string;
  MAX_ORDER_QUANTITY: number;
  EVENTS_TOPIC_ARN: string;
  SHORTAGES_TOPIC_ARN: string;
}) {
  const orders = new DynamoOrders({
    client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    tableName: config.TABLE_NAME,
  });
  const publisher = createEventPublisher(config);
  const track = trackOrder({ orders });

  /** Every event of the order flow updates the order history (PLANNING §3.2). */
  async function handle(event: DomainEvent): Promise<undefined> {
    await track(event);
    return undefined;
  }

  return {
    handle,
    routes: createRoutes({ orders, publisher, maxQuantity: config.MAX_ORDER_QUANTITY }),
    /** Creates the first workday if there is none, so the warehouse begins with 5 of each. */
    seed: seedFirstWorkday({ orders, publisher }),
  };
}
