import {
  createConsumer,
  createLogger,
  httpConfig,
  loadConfig,
  messagingConfig,
  serveHttp,
  shutdownSignal,
} from '@alegra-lunch/shared';
import { z } from 'zod';

import { wire } from '../wiring';

const config = loadConfig({ ...messagingConfig, ...httpConfig, TABLE_NAME: z.string().min(1) });
const logger = createLogger({ service: 'kitchen' });
const { handle, routes } = wire(config, logger);

const signal = shutdownSignal(logger);
void serveHttp({ routes, port: config.PORT, corsOrigin: config.CORS_ORIGIN, logger, signal });
logger.info('Kitchen is consuming its queue');
void createConsumer(config, handle, logger).run(signal);
