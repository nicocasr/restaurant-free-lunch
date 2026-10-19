import {
  createLambdaHttpHandler,
  createLambdaQueueHandler,
  createLogger,
  lambdaConfig,
  loadConfig,
} from '@alegra-lunch/shared';
import { z } from 'zod';

import { wire } from '../wiring';

const config = loadConfig({ ...lambdaConfig, TABLE_NAME: z.string().min(1) });
const logger = createLogger({ service: 'warehouse' });
const { handle, routes } = wire(config, logger);

/** Triggered by the warehouse queue (PLANNING §3.2). */
export const queue = createLambdaQueueHandler(config, handle, logger);

/** GET /inventory behind the shared HTTP API. */
export const http = createLambdaHttpHandler({ routes, corsOrigin: config.CORS_ORIGIN, logger });
