import { parseEvent, type DomainEvent } from '@alegra-lunch/contracts';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type Message,
  type SQSClient,
} from '@aws-sdk/client-sqs';

/** What a handler may ask for: nothing (done), or to see the message again later. */
export type MessageHandler = (
  event: DomainEvent,
) => Promise<{ retryAfterSeconds: number } | undefined>;

interface Logger {
  info: (message: string, fields?: Record<string, unknown>) => void;
  error: (message: string, fields?: Record<string, unknown>) => void;
}

/** A failed message comes back after 1 s, 2 s, 4 s… up to this, instead of the full timeout. */
const MAX_FAILURE_DELAY_SECONDS = 30;

/**
 * Consumes a service queue (PLANNING §3.2 and §3.3). For each message:
 * - valid and handled: deleted;
 * - the handler asks to retry later (the market had nothing to sell): hidden for that long;
 * - the handler fails (a transient error): hidden for a short, growing delay, then retried;
 * - invalid (not JSON or breaks the contract): moved to the DLQ, since retrying never helps.
 */
export class SqsConsumer {
  private readonly client: SQSClient;
  private readonly queueUrl: string;
  private readonly dlqUrl: string;
  private readonly handle: MessageHandler;
  private readonly logger: Logger;
  private readonly waitTimeSeconds: number;

  constructor(deps: {
    client: SQSClient;
    queueUrl: string;
    dlqUrl: string;
    handle: MessageHandler;
    logger: Logger;
    waitTimeSeconds?: number;
  }) {
    this.client = deps.client;
    this.queueUrl = deps.queueUrl;
    this.dlqUrl = deps.dlqUrl;
    this.handle = deps.handle;
    this.logger = deps.logger;
    this.waitTimeSeconds = deps.waitTimeSeconds ?? 20;
  }

  /** Polls until the signal aborts; long polling keeps idle queues cheap. */
  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.consumeOnce();
      } catch (error) {
        this.logger.error('Could not poll the queue', { error, queueUrl: this.queueUrl });
      }
    }
  }

  /** Receives one batch of up to 10 messages and processes them at the same time. */
  async consumeOnce(): Promise<number> {
    const { Messages = [] } = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: this.waitTimeSeconds,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }),
    );
    await Promise.all(Messages.map((message) => this.process(message)));
    return Messages.length;
  }

  private async process(message: Message): Promise<void> {
    let event: DomainEvent;
    try {
      event = parseEvent(JSON.parse(message.Body ?? ''));
    } catch (error) {
      this.logger.error('Invalid message moved to the DLQ', {
        error,
        messageId: message.MessageId,
      });
      await this.moveToDlq(message);
      return;
    }

    try {
      const result = await this.handle(event);
      if (result) {
        await this.hide(message, result.retryAfterSeconds);
      } else {
        await this.delete(message);
      }
    } catch (error) {
      const receives = Number(message.Attributes?.ApproximateReceiveCount ?? 1);
      const delay = Math.min(MAX_FAILURE_DELAY_SECONDS, 2 ** (receives - 1));
      this.logger.error('Message failed, it will be retried', {
        error,
        type: event.type,
        correlationId: event.correlationId,
        retryInSeconds: delay,
      });
      await this.hide(message, delay);
    }
  }

  private async moveToDlq(message: Message): Promise<void> {
    const fifo = this.dlqUrl.endsWith('.fifo');
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.dlqUrl,
        MessageBody: message.Body ?? '',
        ...(fifo && { MessageGroupId: 'invalid', MessageDeduplicationId: message.MessageId }),
      }),
    );
    await this.delete(message);
  }

  private async hide(message: Message, seconds: number): Promise<void> {
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: seconds,
      }),
    );
  }

  private async delete(message: Message): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: message.ReceiptHandle }),
    );
  }
}
