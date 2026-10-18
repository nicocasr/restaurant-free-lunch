import {
  createConsumer,
  createEventPublisher,
  createLogger,
  httpConfig,
  loadConfig,
  messagingConfig,
  serveHttp,
  shutdownSignal,
} from '@alegra-lunch/shared';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';

import { seedFirstWorkday } from '../../application/start-workday';
import { trackOrder } from '../../application/track-order';
import { DynamoOrders } from '../../infrastructure/dynamo-orders';
import { createRoutes, statusFor } from '../http/routes';

const config = loadConfig({
  ...messagingConfig,
  ...httpConfig,
  TABLE_NAME: z.string().min(1),
  MAX_ORDER_QUANTITY: z.coerce.number().int().positive().default(1_000),
});
const logger = createLogger({ service: 'orders' });

const orders = new DynamoOrders({
  client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  tableName: config.TABLE_NAME,
});
const publisher = createEventPublisher(config);
const track = trackOrder({ orders });

async function main(): Promise<void> {
  const signal = shutdownSignal(logger);

  // The first start creates the first workday, so the warehouse begins with 5 of each (§3.7).
  const { workdayId } = await seedFirstWorkday({ orders, publisher })();
  logger.info('Active workday', { workdayId });

  await serveHttp({
    routes: createRoutes({ orders, publisher, maxQuantity: config.MAX_ORDER_QUANTITY }),
    statusFor,
    port: config.PORT,
    corsOrigin: config.CORS_ORIGIN,
    logger,
    signal,
  });
  await createConsumer(
    config,
    async (event) => {
      await track(event);
      return undefined;
    },
    logger,
  ).run(signal);
}

main().catch((error: unknown) => {
  logger.error('Orders failed to start', { error });
  process.exit(1);
});
