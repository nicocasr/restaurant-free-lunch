import type { DomainEvent } from '@alegra-lunch/contracts';
import { createEventPublisher, type Logger } from '@alegra-lunch/shared';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { assignRecipe } from '../application/assign-recipe';
import { deliverDish } from '../application/deliver-dish';
import { DynamoKitchen } from '../infrastructure/dynamo-kitchen';
import { createRoutes } from './http/routes';

/** The real adapters connected to the use cases, shared by the container and Lambda. */
export function wire(
  config: { TABLE_NAME: string; EVENTS_TOPIC_ARN: string; SHORTAGES_TOPIC_ARN: string },
  logger: Logger,
) {
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

  return { handle, routes: createRoutes() };
}
