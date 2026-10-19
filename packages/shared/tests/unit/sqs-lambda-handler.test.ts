import { randomUUID } from 'node:crypto';

import { createEvent } from '@alegra-lunch/contracts';
import type { SQSRecord } from 'aws-lambda';

import { createSqsHandler } from '../../src/lambda/sqs-lambda-handler';

/** An SQS client that records the commands it gets instead of calling AWS. */
function fakeSqs() {
  const sent: { command: string; input: Record<string, unknown> }[] = [];
  return {
    sent,
    client: {
      send: (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        sent.push({ command: command.constructor.name, input: command.input });
        return Promise.resolve({});
      },
    },
  };
}

const queueArn = 'arn:aws:sqs:us-east-1:123456789012:kitchen';

function record(body: string, receives = 1): SQSRecord {
  return {
    messageId: randomUUID(),
    receiptHandle: `receipt-${randomUUID()}`,
    body,
    attributes: {
      ApproximateReceiveCount: String(receives),
      SentTimestamp: '0',
      SenderId: 'sns',
      ApproximateFirstReceiveTimestamp: '0',
    },
    messageAttributes: {},
    md5OfBody: '',
    eventSource: 'aws:sqs',
    eventSourceARN: queueArn,
    awsRegion: 'us-east-1',
  };
}

const valid = () =>
  JSON.stringify(
    createEvent(
      'OrderPlaced',
      { orderId: randomUUID(), workdayId: randomUUID() },
      { correlationId: randomUUID() },
    ),
  );

const logger = { info: jest.fn(), error: jest.fn() };
const dlqUrl = 'https://sqs.us-east-1.amazonaws.com/123456789012/kitchen-dlq';

describe('createSqsHandler (Lambda)', () => {
  it('lets Lambda delete the messages it handled', async () => {
    const sqs = fakeSqs();
    const handler = createSqsHandler({
      client: sqs.client,
      dlqUrl,
      logger,
      handle: () => Promise.resolve(undefined),
    });

    const response = await handler({ Records: [record(valid()), record(valid())] });

    expect(response).toEqual({ batchItemFailures: [] });
    expect(sqs.sent).toEqual([]);
  });

  it('hides a message for the time the handler asks and keeps it in the queue', async () => {
    const sqs = fakeSqs();
    const message = record(valid());
    const handler = createSqsHandler({
      client: sqs.client,
      dlqUrl,
      logger,
      handle: () => Promise.resolve({ retryAfterSeconds: 3 }),
    });

    const response = await handler({ Records: [message] });

    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: message.messageId }] });
    expect(sqs.sent).toEqual([
      {
        command: 'ChangeMessageVisibilityCommand',
        input: {
          QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/kitchen',
          ReceiptHandle: message.receiptHandle,
          VisibilityTimeout: 3,
        },
      },
    ]);
  });

  it('retries a failed message soon and logs why', async () => {
    const sqs = fakeSqs();
    const message = record(valid(), 3);
    const handler = createSqsHandler({
      client: sqs.client,
      dlqUrl,
      logger,
      handle: () => Promise.reject(new Error('database unavailable')),
    });

    const response = await handler({ Records: [message] });

    expect(response.batchItemFailures).toEqual([{ itemIdentifier: message.messageId }]);
    expect(sqs.sent[0]?.input).toMatchObject({ VisibilityTimeout: 4 });
    expect(logger.error).toHaveBeenCalled();
  });

  it('moves an invalid message to the DLQ and lets Lambda delete it', async () => {
    const sqs = fakeSqs();
    const handler = createSqsHandler({
      client: sqs.client,
      dlqUrl,
      logger,
      handle: () => Promise.resolve(undefined),
    });

    const response = await handler({ Records: [record('{"type":')] });

    expect(response).toEqual({ batchItemFailures: [] });
    expect(sqs.sent).toEqual([
      { command: 'SendMessageCommand', input: { QueueUrl: dlqUrl, MessageBody: '{"type":' } },
    ]);
  });

  it('groups invalid messages of a FIFO DLQ so it accepts them', async () => {
    const sqs = fakeSqs();
    const fifoDlq = 'https://sqs.us-east-1.amazonaws.com/123456789012/market-dlq.fifo';
    const message = record('not json');
    const handler = createSqsHandler({
      client: sqs.client,
      dlqUrl: fifoDlq,
      logger,
      handle: () => Promise.resolve(undefined),
    });

    await handler({ Records: [message] });

    expect(sqs.sent[0]?.input).toEqual({
      QueueUrl: fifoDlq,
      MessageBody: 'not json',
      MessageGroupId: 'invalid',
      MessageDeduplicationId: message.messageId,
    });
  });
});
