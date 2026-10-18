import type { DomainEvent } from '@alegra-lunch/contracts';
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

import { assignRecipe } from '../../application/assign-recipe';
import { deliverDish } from '../../application/deliver-dish';
import { DynamoKitchen } from '../../infrastructure/dynamo-kitchen';
import { createRoutes } from '../http/routes';

const config = loadConfig({ ...messagingConfig, ...httpConfig, TABLE_NAME: z.string().min(1) });
const logger = createLogger({ service: 'kitchen' });

const kitchen = new DynamoKitchen({
  client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  tableName: config.TABLE_NAME,
});
const publisher = createEventPublisher(config);

const onOrderPlaced = assignRecipe({ kitchen, publisher });
const onIngredientsReserved = deliverDish({ kitchen, publisher });

/** The queue subscription only delivers these two event types (PLANNING §3.2). */
async function handle(event: DomainEvent): Promise<undefined> {
  switch (event.type) {
    case 'OrderPlaced':
      await onOrderPlaced(event);
      break;
    case 'IngredientsReserved':
      await onIngredientsReserved(event);
      break;
    default:
      logger.warn('Ignored an event this service does not consume', { type: event.type });
  }
  return undefined;
}

const signal = shutdownSignal(logger);
void serveHttp({
  routes: createRoutes(),
  port: config.PORT,
  corsOrigin: config.CORS_ORIGIN,
  logger,
  signal,
});
logger.info('Kitchen is consuming its queue');
void createConsumer(config, handle, logger).run(signal);
