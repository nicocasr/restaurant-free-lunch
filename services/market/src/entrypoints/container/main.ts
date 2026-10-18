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

import { purchaseIngredient } from '../../application/purchase-ingredient';
import { DynamoPurchases } from '../../infrastructure/dynamo-purchases';
import { HttpFarmersMarket } from '../../infrastructure/http-farmers-market';

const config = loadConfig({
  ...messagingConfig,
  TABLE_NAME: z.string().min(1),
  FARMERS_MARKET_URL: z.url(),
  FARMERS_MARKET_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
});
const logger = createLogger({ service: 'market' });

const onStockShortage = purchaseIngredient({
  market: new HttpFarmersMarket({
    baseUrl: config.FARMERS_MARKET_URL,
    timeoutMs: config.FARMERS_MARKET_TIMEOUT_MS,
  }),
  purchases: new DynamoPurchases({
    client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    tableName: config.TABLE_NAME,
  }),
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

logger.info('Market is consuming its queue');
void createConsumer(config, handle, logger).run(shutdownSignal(logger));
