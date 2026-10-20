import {
  createConsumer,
  createLogger,
  httpConfig,
  loadConfig,
  messagingConfig,
  serveHttp,
  shutdownSignal,
} from '@alegra-lunch/shared';

import { statusFor } from '../http/routes';
import { ordersConfig, wire } from '../wiring';

const config = loadConfig({ ...messagingConfig, ...httpConfig, ...ordersConfig });
const logger = createLogger({ service: 'orders' });
const { handle, routes, seed } = wire(config);

async function main(): Promise<void> {
  const signal = shutdownSignal(logger);

  // The first start creates the first workday, so the warehouse begins with 5 of each (§3.5).
  const { workdayId } = await seed();
  logger.info('Active workday', { workdayId });

  await serveHttp({
    routes,
    statusFor,
    port: config.PORT,
    corsOrigin: config.CORS_ORIGIN,
    logger,
    signal,
  });
  await createConsumer(config, handle, logger).run(signal);
}

main().catch((error: unknown) => {
  logger.error('Orders failed to start', { error });
  process.exit(1);
});
