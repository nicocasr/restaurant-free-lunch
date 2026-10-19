import {
  createLambdaHttpHandler,
  createLambdaQueueHandler,
  createLogger,
  lambdaConfig,
  loadConfig,
} from '@alegra-lunch/shared';

import { marketConfig, wire } from '../wiring';

const config = loadConfig({ ...lambdaConfig, ...marketConfig });
const logger = createLogger({ service: 'market' });
const { handle, routes } = wire(config, logger);

/**
 * Triggered by the market FIFO queue, one message at a time: the queue never hands over a
 * message of an ingredient while another of the same ingredient is in flight (PLANNING §3.3).
 */
export const queue = createLambdaQueueHandler(config, handle, logger);

/** GET /purchases behind the shared HTTP API. */
export const http = createLambdaHttpHandler({ routes, corsOrigin: config.CORS_ORIGIN, logger });
