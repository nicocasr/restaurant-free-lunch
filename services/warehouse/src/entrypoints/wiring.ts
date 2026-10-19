import type { DomainEvent } from '@alegra-lunch/contracts';
import { createEventPublisher, type Logger } from '@alegra-lunch/shared';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { receivePurchase } from '../application/receive-purchase';
import { requestIngredients } from '../application/request-ingredients';
import { startWorkday } from '../application/start-workday';
import { DynamoWarehouse } from '../infrastructure/dynamo-warehouse';
import { createRoutes } from './http/routes';

/**
 * The real adapters connected to the use cases, shared by both runtimes: the container
 * (docker compose) and Lambda only differ in how events and requests reach these handlers.
 */
export function wire(
  config: { TABLE_NAME: string; EVENTS_TOPIC_ARN: string; SHORTAGES_TOPIC_ARN: string },
  logger: Logger,
) {
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

  return { handle, routes: createRoutes({ warehouse }) };
}
