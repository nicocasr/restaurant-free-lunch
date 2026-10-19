import type { DomainEvent } from '@alegra-lunch/contracts';
import { createEventPublisher, type Logger } from '@alegra-lunch/shared';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';

import { purchaseIngredient } from '../application/purchase-ingredient';
import { DynamoPurchases } from '../infrastructure/dynamo-purchases';
import { HttpFarmersMarket } from '../infrastructure/http-farmers-market';
import { createRoutes } from './http/routes';

/** Variables of the market in both runtimes. */
export const marketConfig = {
  TABLE_NAME: z.string().min(1),
  FARMERS_MARKET_URL: z.url(),
  FARMERS_MARKET_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
};

/** The real adapters connected to the use case, shared by the container and Lambda. */
export function wire(
  config: {
    TABLE_NAME: string;
    FARMERS_MARKET_URL: string;
    FARMERS_MARKET_TIMEOUT_MS: number;
    EVENTS_TOPIC_ARN: string;
    SHORTAGES_TOPIC_ARN: string;
  },
  logger: Logger,
) {
  const purchases = new DynamoPurchases({
    client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    tableName: config.TABLE_NAME,
  });
  const onStockShortage = purchaseIngredient({
    market: new HttpFarmersMarket({
      baseUrl: config.FARMERS_MARKET_URL,
      timeoutMs: config.FARMERS_MARKET_TIMEOUT_MS,
    }),
    purchases,
    publisher: createEventPublisher(config),
  });

  /** When the market has nothing to sell, the queue hides the message for a while (§3.3). */
  async function handle(event: DomainEvent): Promise<{ retryAfterSeconds: number } | undefined> {
    if (event.type !== 'StockShortage') {
      logger.warn('Ignored an event this service does not consume', { type: event.type });
      return undefined;
    }
    const outcome = await onStockShortage(event);
    return outcome.status === 'retry' ? { retryAfterSeconds: outcome.delaySeconds } : undefined;
  }

  return { handle, routes: createRoutes({ purchases }) };
}
