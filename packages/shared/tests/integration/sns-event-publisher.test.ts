import { randomUUID } from 'node:crypto';

import { createEvent, type DomainEvent } from '@alegra-lunch/contracts';
import {
  CreateTopicCommand,
  DeleteTopicCommand,
  SNSClient,
  SubscribeCommand,
} from '@aws-sdk/client-sns';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

import { SnsEventPublisher } from '../../src/infrastructure/sns-event-publisher';

const sns = new SNSClient({});
// LocalStack answers queue URLs on its own domain: keep calling the configured endpoint.
const sqs = new SQSClient({ useQueueUrlAsEndpoint: false });

afterAll(() => {
  sns.destroy();
  sqs.destroy();
});

/** A topic subscribed by a queue, both just for one test, like infra/localstack creates them. */
async function topicWithQueue(name: string, fifo: boolean) {
  const suffix = fifo ? '.fifo' : '';
  const { TopicArn } = await sns.send(
    new CreateTopicCommand({
      Name: `${name}${suffix}`,
      ...(fifo && { Attributes: { FifoTopic: 'true' } }),
    }),
  );
  const { QueueUrl } = await sqs.send(
    new CreateQueueCommand({
      QueueName: `${name}${suffix}`,
      ...(fifo && { Attributes: { FifoQueue: 'true' } }),
    }),
  );
  const { Attributes } = await sqs.send(
    new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ['QueueArn'] }),
  );
  await sns.send(
    new SubscribeCommand({
      TopicArn,
      Protocol: 'sqs',
      Endpoint: Attributes?.['QueueArn'],
      Attributes: { RawMessageDelivery: 'true' },
    }),
  );
  return {
    topicArn: TopicArn as string,
    receive: async () => {
      const { Messages } = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
          MessageAttributeNames: ['All'],
          MessageSystemAttributeNames: ['MessageGroupId', 'MessageDeduplicationId'],
        }),
      );
      return Messages ?? [];
    },
    dispose: async () => {
      await sns.send(new DeleteTopicCommand({ TopicArn }));
      await sqs.send(new DeleteQueueCommand({ QueueUrl }));
    },
  };
}

describe('SnsEventPublisher', () => {
  let events: Awaited<ReturnType<typeof topicWithQueue>>;
  let shortages: Awaited<ReturnType<typeof topicWithQueue>>;
  let publisher: SnsEventPublisher;

  beforeEach(async () => {
    const id = randomUUID();
    events = await topicWithQueue(`events-${id}`, false);
    shortages = await topicWithQueue(`shortages-${id}`, true);
    publisher = new SnsEventPublisher({
      client: sns,
      eventsTopicArn: events.topicArn,
      shortagesTopicArn: shortages.topicArn,
    });
  });

  afterEach(async () => {
    await events.dispose();
    await shortages.dispose();
  });

  const context = { correlationId: randomUUID() };

  it('publishes the event as JSON, with its type as an attribute for the filters', async () => {
    const event = createEvent(
      'OrderPlaced',
      { orderId: randomUUID(), workdayId: randomUUID() },
      context,
    );

    await publisher.publish(event);

    const [message] = await events.receive();
    expect(JSON.parse(message?.Body ?? '') as DomainEvent).toEqual(event);
    expect(message?.MessageAttributes?.['type']?.StringValue).toBe('OrderPlaced');
  });

  it('sends StockShortage to the FIFO topic, one group per ingredient', async () => {
    const event = createEvent(
      'StockShortage',
      { shortageId: randomUUID(), workdayId: randomUUID(), ingredient: 'onion', quantity: 3 },
      context,
    );

    await publisher.publish(event);

    const [message] = await shortages.receive();
    expect(JSON.parse(message?.Body ?? '') as DomainEvent).toEqual(event);
    expect(message?.Attributes?.['MessageGroupId']).toBe('onion');
    expect(message?.Attributes?.['MessageDeduplicationId']).toBe(event.id);
    expect(await events.receive()).toEqual([]);
  });

  it('publishes many events at once, still routing each one to its topic', async () => {
    // More than one SNS batch (10 entries), with a shortage mixed in
    const orders = Array.from({ length: 25 }, () =>
      createEvent('OrderPlaced', { orderId: randomUUID(), workdayId: randomUUID() }, context),
    );
    const shortage = createEvent(
      'StockShortage',
      { shortageId: randomUUID(), workdayId: randomUUID(), ingredient: 'potato', quantity: 2 },
      context,
    );

    await publisher.publishAll([...orders.slice(0, 12), shortage, ...orders.slice(12)]);

    const received: string[] = [];
    for (let poll = 0; poll < 10 && received.length < orders.length; poll++) {
      for (const message of await events.receive()) {
        received.push((JSON.parse(message.Body ?? '') as DomainEvent).id);
      }
    }
    expect(received.sort()).toEqual(orders.map(({ id }) => id).sort());

    const [message] = await shortages.receive();
    expect(message?.Attributes?.['MessageGroupId']).toBe('potato');
  });
});
