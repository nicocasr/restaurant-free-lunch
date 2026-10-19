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

// LocalStack answers queue URLs on its own domain: keep calling the configured endpoint.
const sqs = new SQSClient({ useQueueUrlAsEndpoint: false });
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

  it('finishes the message in hand on shutdown, so none is left hidden', async () => {
    // Cancelling the poll would not help: SQS would still hand the message to the abandoned
    // request and hide it for the whole visibility timeout
    const controller = new AbortController();
    const handled: string[] = [];
    const running = new SqsConsumer({
      client: sqs,
      queueUrl,
      dlqUrl,
      logger,
      waitTimeSeconds: 1,
      handle: (event) => {
        handled.push(event.id);
        return Promise.resolve(undefined);
      },
    }).run(controller.signal);
    const event = orderPlaced();
    await send(JSON.stringify(event));
    await sleep(300);

    controller.abort();
    await running;

    expect(handled).toEqual([event.id]);
    expect(await totalMessages(queueUrl)).toBe(0);
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

describe('SqsConsumer on a FIFO queue', () => {
  let fifoUrl: string;
  let fifoDlqUrl: string;

  beforeEach(async () => {
    const id = randomUUID();
    const create = async (name: string) => {
      const { QueueUrl } = await sqs.send(
        new CreateQueueCommand({ QueueName: name, Attributes: { FifoQueue: 'true' } }),
      );
      return QueueUrl as string;
    };
    fifoUrl = await create(`consumer-${id}.fifo`);
    fifoDlqUrl = await create(`consumer-${id}-dlq.fifo`);
  });

  afterEach(async () => {
    await sqs.send(new DeleteQueueCommand({ QueueUrl: fifoUrl }));
    await sqs.send(new DeleteQueueCommand({ QueueUrl: fifoDlqUrl }));
  });

  const shortage = (ingredient: 'onion' | 'potato') =>
    createEvent(
      'StockShortage',
      { shortageId: randomUUID(), workdayId: randomUUID(), ingredient, quantity: 1 },
      { correlationId: randomUUID() },
    );

  it('handles one message at a time per group, in order, and different groups in parallel', async () => {
    // A FIFO queue may hand over several messages of the same group in one batch: they are
    // one purchase per ingredient at a time (PLANNING §3.3), so they must not run together
    const onions = [shortage('onion'), shortage('onion'), shortage('onion')];
    const potato = shortage('potato');
    for (const event of [...onions, potato]) {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: fifoUrl,
          MessageBody: JSON.stringify(event),
          MessageGroupId: event.payload.ingredient,
          MessageDeduplicationId: event.id,
        }),
      );
    }

    const running = new Map<string, number>();
    let maxOnionsAtOnce = 0;
    let potatoOverlappedOnions = false;
    const handledOnions: string[] = [];
    const controller = new AbortController();
    const consumer = new SqsConsumer({
      client: sqs,
      queueUrl: fifoUrl,
      dlqUrl: fifoDlqUrl,
      logger,
      waitTimeSeconds: 1,
      handle: async (event) => {
        if (event.type !== 'StockShortage') return undefined;
        const { ingredient } = event.payload;
        running.set(ingredient, (running.get(ingredient) ?? 0) + 1);
        maxOnionsAtOnce = Math.max(maxOnionsAtOnce, running.get('onion') ?? 0);
        if (ingredient === 'potato' && (running.get('onion') ?? 0) > 0) {
          potatoOverlappedOnions = true;
        }
        await sleep(300);
        if (ingredient === 'onion') handledOnions.push(event.id);
        running.set(ingredient, (running.get(ingredient) ?? 1) - 1);
        return undefined;
      },
    });

    const consuming = consumer.run(controller.signal);
    for (let wait = 0; wait < 40 && handledOnions.length < onions.length; wait++) {
      await sleep(250);
    }
    controller.abort();
    await consuming;

    expect(maxOnionsAtOnce).toBe(1);
    expect(handledOnions).toEqual(onions.map(({ id }) => id));
    expect(potatoOverlappedOnions).toBe(true);
  });
});
