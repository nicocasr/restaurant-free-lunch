import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { createEvent, type DomainEvent } from '@alegra-lunch/contracts';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

import { SqsConsumer, type MessageHandler } from '../../src/infrastructure/sqs-consumer';

const sqs = new SQSClient({});
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

afterAll(() => {
  sqs.destroy();
});

async function queue(name: string): Promise<string> {
  const { QueueUrl } = await sqs.send(new CreateQueueCommand({ QueueName: name }));
  return QueueUrl as string;
}

async function visibleMessages(queueUrl: string): Promise<number> {
  const { Attributes } = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
    }),
  );
  return Number(Attributes?.['ApproximateNumberOfMessages']);
}

async function totalMessages(queueUrl: string): Promise<number> {
  const { Attributes } = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
    }),
  );
  return (
    Number(Attributes?.['ApproximateNumberOfMessages']) +
    Number(Attributes?.['ApproximateNumberOfMessagesNotVisible'])
  );
}

describe('SqsConsumer', () => {
  let queueUrl: string;
  let dlqUrl: string;

  beforeEach(async () => {
    const id = randomUUID();
    queueUrl = await queue(`consumer-${id}`);
    dlqUrl = await queue(`consumer-${id}-dlq`);
  });

  afterEach(async () => {
    await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
    await sqs.send(new DeleteQueueCommand({ QueueUrl: dlqUrl }));
  });

  const consumer = (handle: MessageHandler) =>
    new SqsConsumer({ client: sqs, queueUrl, dlqUrl, handle, logger, waitTimeSeconds: 1 });

  const send = (body: string) =>
    sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }));

  const orderPlaced = () =>
    createEvent(
      'OrderPlaced',
      { orderId: randomUUID(), workdayId: randomUUID() },
      { correlationId: randomUUID() },
    );

  it('hands the validated event to the handler and deletes the message', async () => {
    const event = orderPlaced();
    await send(JSON.stringify(event));
    const handled: DomainEvent[] = [];

    await consumer((received) => {
      handled.push(received);
      return Promise.resolve(undefined);
    }).consumeOnce();

    expect(handled).toEqual([event]);
    expect(await totalMessages(queueUrl)).toBe(0);
  });

  it.each([
    ['is not JSON', '{"type":'],
    ['breaks the contract', JSON.stringify({ ...orderPlaced(), version: 99 })],
  ])('sends a message that %s to the DLQ, without calling the handler', async (_, body) => {
    await send(body);
    const handle = jest.fn<ReturnType<MessageHandler>, Parameters<MessageHandler>>();

    await consumer(handle).consumeOnce();

    expect(handle).not.toHaveBeenCalled();
    expect(await totalMessages(queueUrl)).toBe(0);
    const { Messages } = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: dlqUrl, WaitTimeSeconds: 1 }),
    );
    expect(Messages?.[0]?.Body).toBe(body);
  });

  it('hides the message for the time the handler asks, so the queue does the waiting', async () => {
    await send(JSON.stringify(orderPlaced()));
    let calls = 0;
    const retrying = consumer(() => {
      calls += 1;
      return Promise.resolve(calls === 1 ? { retryAfterSeconds: 2 } : undefined);
    });

    await retrying.consumeOnce();
    expect(await visibleMessages(queueUrl)).toBe(0);
    expect(await totalMessages(queueUrl)).toBe(1);

    await sleep(2_500);
    await retrying.consumeOnce();

    expect(calls).toBe(2);
    expect(await totalMessages(queueUrl)).toBe(0);
  });

  it('keeps the message for a later retry when the handler fails, and logs why', async () => {
    await send(JSON.stringify(orderPlaced()));

    await consumer(() => Promise.reject(new Error('database unavailable'))).consumeOnce();

    expect(await totalMessages(queueUrl)).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ error: expect.any(Error) as Error }),
    );
  });

  it('retries a failed message soon, instead of waiting the whole visibility timeout', async () => {
    await send(JSON.stringify(orderPlaced()));
    let calls = 0;
    const flaky = consumer(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('transient')) : Promise.resolve(undefined);
    });

    await flaky.consumeOnce();
    await sleep(2_500);
    await flaky.consumeOnce();

    expect(calls).toBe(2);
    expect(await totalMessages(queueUrl)).toBe(0);
  });
});
