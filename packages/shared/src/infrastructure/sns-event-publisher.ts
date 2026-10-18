import type { DomainEvent } from '@alegra-lunch/contracts';
import {
  PublishBatchCommand,
  PublishCommand,
  type PublishBatchRequestEntry,
  type SNSClient,
} from '@aws-sdk/client-sns';

/** SNS accepts up to 10 entries per PublishBatch. */
const ENTRIES_PER_BATCH = 10;
/** Batches sent at the same time: a thousand events go out in a handful of round trips. */
const PARALLEL_BATCHES = 10;

/**
 * Publishes events to SNS (PLANNING §3.2). It matches the EventPublisher port of every service
 * structurally. StockShortage goes to the FIFO topic, grouped by ingredient, so the market
 * queue gets one purchase at a time per ingredient; every other event goes to the standard
 * topic. The type travels as an attribute, so each subscription filters what its queue gets.
 */
export class SnsEventPublisher {
  private readonly client: SNSClient;
  private readonly eventsTopicArn: string;
  private readonly shortagesTopicArn: string;

  constructor(deps: { client: SNSClient; eventsTopicArn: string; shortagesTopicArn: string }) {
    this.client = deps.client;
    this.eventsTopicArn = deps.eventsTopicArn;
    this.shortagesTopicArn = deps.shortagesTopicArn;
  }

  async publish(event: DomainEvent): Promise<void> {
    await this.client.send(
      new PublishCommand({ TopicArn: this.topicOf(event), ...entryOf(event) }),
    );
  }

  /**
   * Publishes many events in batches of 10, several batches at a time. If any entry fails it
   * throws, so the caller retries; consumers are idempotent, so the events that did go out
   * once are safe to send again.
   */
  async publishAll(events: readonly DomainEvent[]): Promise<void> {
    const batches: { topicArn: string; events: DomainEvent[] }[] = [];
    for (const [topicArn, ofTopic] of Map.groupBy(events, (event) => this.topicOf(event))) {
      for (let start = 0; start < ofTopic.length; start += ENTRIES_PER_BATCH) {
        batches.push({ topicArn, events: ofTopic.slice(start, start + ENTRIES_PER_BATCH) });
      }
    }

    for (let start = 0; start < batches.length; start += PARALLEL_BATCHES) {
      await Promise.all(
        batches.slice(start, start + PARALLEL_BATCHES).map((batch) => this.sendBatch(batch)),
      );
    }
  }

  private async sendBatch({ topicArn, events }: { topicArn: string; events: DomainEvent[] }) {
    const { Failed } = await this.client.send(
      new PublishBatchCommand({
        TopicArn: topicArn,
        PublishBatchRequestEntries: events.map((event): PublishBatchRequestEntry => ({
          Id: event.id,
          ...entryOf(event),
        })),
      }),
    );
    if (Failed && Failed.length > 0) {
      const reasons = Failed.map(({ Id, Code }) => `${String(Id)}: ${String(Code)}`).join(', ');
      throw new Error(`SNS rejected ${String(Failed.length)} events: ${reasons}`);
    }
  }

  private topicOf(event: DomainEvent): string {
    return event.type === 'StockShortage' ? this.shortagesTopicArn : this.eventsTopicArn;
  }
}

/** The message of an event, common to Publish and PublishBatch. */
function entryOf(event: DomainEvent) {
  return {
    Message: JSON.stringify(event),
    MessageAttributes: { type: { DataType: 'String', StringValue: event.type } },
    ...(event.type === 'StockShortage' && {
      MessageGroupId: event.payload.ingredient,
      // A republished event keeps its id, so SNS drops the copy within 5 minutes.
      MessageDeduplicationId: event.id,
    }),
  };
}
