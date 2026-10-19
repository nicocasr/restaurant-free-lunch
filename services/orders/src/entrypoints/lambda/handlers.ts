import {
  createLambdaHttpHandler,
  createLambdaQueueHandler,
  createLogger,
  lambdaConfig,
  loadConfig,
} from '@alegra-lunch/shared';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { statusFor } from '../http/routes';
import { ordersConfig, wire } from '../wiring';

const config = loadConfig({ ...lambdaConfig, ...ordersConfig });
const logger = createLogger({ service: 'orders' });
const { handle, routes, seed } = wire(config);

/** Triggered by the orders queue: every event of the order flow (PLANNING §3.2). */
export const queue = createLambdaQueueHandler(config, handle, logger);

const api = createLambdaHttpHandler({ routes, statusFor, corsOrigin: config.CORS_ORIGIN, logger });

/**
 * A Lambda has no start-up step like a container, so the first request of each instance seeds
 * the first workday. Seeding is idempotent, so instances doing it at once is safe (§3.7).
 */
let seeded: Promise<unknown> | undefined;

/** The manager API behind the shared HTTP API: orders and workdays. */
export async function http(event: APIGatewayProxyEventV2) {
  seeded ??= seed().catch((error: unknown) => {
    seeded = undefined;
    throw error;
  });
  await seeded;
  return api(event);
}
