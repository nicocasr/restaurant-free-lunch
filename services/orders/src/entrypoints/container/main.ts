import { createServer } from 'node:http';

import {
  createConsumer,
  createEventPublisher,
  createLogger,
  createRouter,
  loadConfig,
  messagingConfig,
  nodeListener,
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
  TABLE_NAME: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  MAX_ORDER_QUANTITY: z.coerce.number().int().positive().default(1_000),
  CORS_ORIGIN: z.string().min(1).default('*'),
});
const logger = createLogger({ service: 'orders' });

const orders = new DynamoOrders({
  client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  tableName: config.TABLE_NAME,
});
const publisher = createEventPublisher(config);
const signal = shutdownSignal(logger);

const router = createRouter({
  routes: createRoutes({ orders, publisher, maxQuantity: config.MAX_ORDER_QUANTITY }),
  statusFor,
  corsOrigin: config.CORS_ORIGIN,
  logger,
});
const server = createServer(nodeListener(router, { maxBodyBytes: 16 * 1024 }));
signal.addEventListener('abort', () => server.close());

const track = trackOrder({ orders });

async function main(): Promise<void> {
  // The first start creates the first workday, so the warehouse begins with 5 of each (§3.7).
  const { workdayId } = await seedFirstWorkday({ orders, publisher })();
  logger.info('Active workday', { workdayId });

  server.listen(config.PORT, () => {
    logger.info('Orders API is listening', { port: config.PORT });
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
