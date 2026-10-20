import {
  createLogger,
  httpConfig,
  loadConfig,
  serveHttp,
  shutdownSignal,
} from '@alegra-lunch/shared';
import { z } from 'zod';

import { statusFor } from '../http/routes';
import { assistantConfig, wire } from '../wiring';

const config = loadConfig({
  ...httpConfig,
  ...assistantConfig,
  // From the .env file at the root of the repository, which Git never uploads.
  GEMINI_API_KEY: z.string().optional(),
});
const logger = createLogger({ service: 'assistant' });
const { routes } = wire(config, config.GEMINI_API_KEY || undefined);

if (!config.GEMINI_API_KEY) {
  logger.warn('No GEMINI_API_KEY: the assistant will answer that it is not configured');
}

// The assistant only answers HTTP requests: it consumes no queue.
void serveHttp({
  routes,
  statusFor,
  port: config.PORT,
  corsOrigin: config.CORS_ORIGIN,
  logger,
  signal: shutdownSignal(logger),
});
