import { createServer, type Server } from 'node:http';

import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';

import { SnsEventPublisher } from '../infrastructure/sns-event-publisher';
import { SqsConsumer, type MessageHandler } from '../infrastructure/sqs-consumer';
import { nodeListener } from '../http/node-listener';
import { createHttpHandler } from '../lambda/http-lambda-handler';
import { createSqsHandler } from '../lambda/sqs-lambda-handler';
import { createRouter, type Route } from '../http/router';
import type { Logger } from '../logging/logger';

/** 16 KB is plenty for the manager's requests and refuses abusive bodies early. */
const MAX_BODY_BYTES = 16 * 1024;

/**
 * Aborts when the process is asked to stop: SIGTERM from Docker or Lambda, SIGINT from Ctrl+C.
 * Consumers finish the batch in hand and the HTTP server stops accepting requests.
 */
export function shutdownSignal(logger: Logger): AbortSignal {
  const controller = new AbortController();
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      logger.info('Shutting down', { signal });
      controller.abort();
    });
  }
  return controller.signal;
}

/** The AWS SDK reads the region, credentials and endpoint (LocalStack) from the environment. */
export function createEventPublisher(config: {
  EVENTS_TOPIC_ARN: string;
  SHORTAGES_TOPIC_ARN: string;
}): SnsEventPublisher {
  return new SnsEventPublisher({
    client: new SNSClient({}),
    eventsTopicArn: config.EVENTS_TOPIC_ARN,
    shortagesTopicArn: config.SHORTAGES_TOPIC_ARN,
  });
}

export function createConsumer(
  config: { QUEUE_URL: string; DLQ_URL: string },
  handle: MessageHandler,
  logger: Logger,
): SqsConsumer {
  return new SqsConsumer({
    client: new SQSClient({}),
    queueUrl: config.QUEUE_URL,
    dlqUrl: config.DLQ_URL,
    handle,
    logger,
  });
}

/** The Lambda handler of a service queue (PLANNING §3.3). */
export function createLambdaQueueHandler(
  config: { DLQ_URL: string },
  handle: MessageHandler,
  logger: Logger,
) {
  return createSqsHandler({ client: new SQSClient({}), dlqUrl: config.DLQ_URL, handle, logger });
}

/** The Lambda handler of the HTTP API of a service, behind API Gateway. */
export function createLambdaHttpHandler(options: {
  routes: readonly Route[];
  corsOrigin: string;
  logger: Logger;
  statusFor?: (error: Error) => number | undefined;
}) {
  const router = createRouter({
    routes: options.routes,
    corsOrigin: options.corsOrigin,
    logger: options.logger,
    ...(options.statusFor && { statusFor: options.statusFor }),
  });
  return createHttpHandler(router, { maxBodyBytes: MAX_BODY_BYTES });
}

/** Serves the routes of a service with node:http until it shuts down (PLANNING §3.4). */
export async function serveHttp(options: {
  routes: readonly Route[];
  port: number;
  corsOrigin: string;
  logger: Logger;
  signal: AbortSignal;
  statusFor?: (error: Error) => number | undefined;
}): Promise<Server> {
  const router = createRouter({
    routes: options.routes,
    corsOrigin: options.corsOrigin,
    logger: options.logger,
    ...(options.statusFor && { statusFor: options.statusFor }),
  });
  const server = createServer(nodeListener(router, { maxBodyBytes: MAX_BODY_BYTES }));
  options.signal.addEventListener('abort', () => server.close());
  await new Promise<void>((resolve) => server.listen(options.port, resolve));
  options.logger.info('HTTP API is listening', { port: options.port });
  return server;
}
