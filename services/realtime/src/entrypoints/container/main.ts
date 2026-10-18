import { createServer } from 'node:http';

import { createConsumer, createLogger, loadConfig, shutdownSignal } from '@alegra-lunch/shared';
import { z } from 'zod';

import { broadcastEvents } from '../../application/broadcast-events';
import { EventBatcher } from '../../domain/event-batcher';
import { WebSocketHub } from '../../infrastructure/websocket-hub';

const config = loadConfig({
  QUEUE_URL: z.url(),
  DLQ_URL: z.url(),
  PORT: z.coerce.number().int().positive(),
  BATCH_INTERVAL_MS: z.coerce.number().int().positive().default(500),
});
const logger = createLogger({ service: 'realtime' });
const signal = shutdownSignal(logger);

const server = createServer((_request, response) => {
  response.writeHead(404).end();
});
const hub = new WebSocketHub({ server, path: '/ws' });
const broadcast = broadcastEvents({ connections: hub });

const batcher = new EventBatcher({
  intervalMs: config.BATCH_INTERVAL_MS,
  flush: broadcast,
  onError: (error) => {
    logger.error('Could not send a batch to the dashboards', { error });
  },
});

signal.addEventListener('abort', () => {
  void hub.close().then(() => server.close());
});
server.listen(config.PORT, () => {
  logger.info('Dashboards can connect', { port: config.PORT, path: '/ws' });
});

// The dashboard reloads its data when it reconnects, so a batch lost on a restart is harmless:
// the message is acknowledged as soon as its event joins the batch.
void createConsumer(
  config,
  (event) => {
    batcher.add(event);
    return Promise.resolve(undefined);
  },
  logger,
).run(signal);
