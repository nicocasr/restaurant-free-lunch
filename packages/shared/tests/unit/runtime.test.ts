import type { AddressInfo } from 'node:net';

import { z } from 'zod';

import { SnsEventPublisher } from '../../src/infrastructure/sns-event-publisher';
import { SqsConsumer } from '../../src/infrastructure/sqs-consumer';
import { ConfigError, loadConfig, messagingConfig } from '../../src/runtime/config';
import {
  createConsumer,
  createEventPublisher,
  serveHttp,
  shutdownSignal,
} from '../../src/runtime/runtime';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

const messaging = {
  QUEUE_URL: 'http://localhost:4566/000000000000/kitchen',
  DLQ_URL: 'http://localhost:4566/000000000000/kitchen-dlq',
  EVENTS_TOPIC_ARN: 'arn:aws:sns:us-east-1:000000000000:events',
  SHORTAGES_TOPIC_ARN: 'arn:aws:sns:us-east-1:000000000000:shortages.fifo',
};

describe('loadConfig', () => {
  it('returns the typed values of a valid environment', () => {
    const config = loadConfig(
      { ...messagingConfig, MAX_ORDER_QUANTITY: z.coerce.number().int().positive() },
      { ...messaging, MAX_ORDER_QUANTITY: '1000' },
    );

    expect(config.MAX_ORDER_QUANTITY).toBe(1_000);
    expect(config.QUEUE_URL).toBe(messaging.QUEUE_URL);
  });

  it('refuses to start, naming every variable that is missing or wrong', () => {
    const load = () =>
      loadConfig(messagingConfig, { ...messaging, QUEUE_URL: undefined, DLQ_URL: 'not a url' });

    expect(load).toThrow(ConfigError);
    expect(load).toThrow(/QUEUE_URL[\s\S]*DLQ_URL/);
  });

  it('reads the process environment by default', () => {
    process.env['ALEGRA_LUNCH_TEST_VALUE'] = 'present';

    expect(loadConfig({ ALEGRA_LUNCH_TEST_VALUE: z.string() })).toEqual({
      ALEGRA_LUNCH_TEST_VALUE: 'present',
    });

    delete process.env['ALEGRA_LUNCH_TEST_VALUE'];
  });
});

describe('shutdownSignal', () => {
  it.each(['SIGTERM', 'SIGINT'] as const)('aborts when the process gets %s', (signal) => {
    const aborted = shutdownSignal(logger);

    process.emit(signal);

    expect(aborted.aborted).toBe(true);
    expect(logger.info).toHaveBeenCalledWith('Shutting down', { signal });
  });
});

describe('serveHttp', () => {
  it('serves the routes on the port and stops when the service shuts down', async () => {
    const controller = new AbortController();
    const server = await serveHttp({
      routes: [
        {
          method: 'GET',
          path: '/ping',
          handle: () => Promise.resolve({ status: 200, body: 'pong' }),
        },
      ],
      port: 0,
      corsOrigin: '*',
      logger,
      signal: controller.signal,
    });
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${String(port)}/ping`);
    expect(await response.json()).toBe('pong');

    controller.abort();
    await new Promise((resolve) => server.once('close', resolve));
    expect(server.listening).toBe(false);
  });
});

describe('factories', () => {
  it('build the SNS publisher and the SQS consumer from the configuration', () => {
    expect(createEventPublisher(messaging)).toBeInstanceOf(SnsEventPublisher);
    expect(createConsumer(messaging, () => Promise.resolve(undefined), logger)).toBeInstanceOf(
      SqsConsumer,
    );
  });
});
