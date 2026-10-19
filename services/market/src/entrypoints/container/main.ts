import {
  createConsumer,
  createLogger,
  httpConfig,
  loadConfig,
  messagingConfig,
  serveHttp,
  shutdownSignal,
} from '@alegra-lunch/shared';

import { marketConfig, wire } from '../wiring';

const config = loadConfig({ ...messagingConfig, ...httpConfig, ...marketConfig });
const logger = createLogger({ service: 'market' });
const { handle, routes } = wire(config, logger);

const signal = shutdownSignal(logger);
void serveHttp({ routes, port: config.PORT, corsOrigin: config.CORS_ORIGIN, logger, signal });
logger.info('Market is consuming its queue');
void createConsumer(config, handle, logger).run(signal);
