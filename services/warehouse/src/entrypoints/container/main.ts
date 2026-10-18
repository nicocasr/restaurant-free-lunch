import type { DomainEvent } from '@alegra-lunch/contracts';
import {
  createConsumer,
  createEventPublisher,
  createLogger,
  loadConfig,
  messagingConfig,
  shutdownSignal,
} from '@alegra-lunch/shared';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';

import { receivePurchase } from '../../application/receive-purchase';
import { requestIngredients } from '../../application/request-ingredients';
import { startWorkday } from '../../application/start-workday';
import { DynamoWarehouse } from '../../infrastructure/dynamo-warehouse';

const config = loadConfig({ ...messagingConfig, TABLE_NAME: z.string().min(1) });
const logger = createLogger({ service: 'warehouse' });

const warehouse = new DynamoWarehouse({
  client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  tableName: config.TABLE_NAME,
});
const publisher = createEventPublisher(config);

const onWorkdayStarted = startWorkday({ warehouse });
const onIngredientsRequested = requestIngredients({ warehouse, publisher });
const onIngredientPurchased = receivePurchase({ warehouse, publisher });

/** The queue subscription only delivers these three event types (PLANNING §3.2). */
async function handle(event: DomainEvent): Promise<undefined> {
  switch (event.type) {
    case 'WorkdayStarted':
      await onWorkdayStarted(event);
      break;
    case 'IngredientsRequested':
      await onIngredientsRequested(event);
      break;
    case 'IngredientPurchased':
      await onIngredientPurchased(event);
      break;
    default:
      logger.warn('Ignored an event this service does not consume', { type: event.type });
  }
  return undefined;
}

logger.info('Warehouse is consuming its queue');
void createConsumer(config, handle, logger).run(shutdownSignal(logger));
