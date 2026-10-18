import type { DomainEvent } from '@alegra-lunch/contracts';
import { PublishCommand, type SNSClient } from '@aws-sdk/client-sns';

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
      new PublishCommand({
        Message: JSON.stringify(event),
        MessageAttributes: { type: { DataType: 'String', StringValue: event.type } },
        ...(event.type === 'StockShortage'
          ? {
              TopicArn: this.shortagesTopicArn,
              MessageGroupId: event.payload.ingredient,
              // A republished event keeps its id, so SNS drops the copy within 5 minutes.
              MessageDeduplicationId: event.id,
            }
          : { TopicArn: this.eventsTopicArn }),
      }),
    );
  }
}
