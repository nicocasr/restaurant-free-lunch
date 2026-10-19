import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type Message,
  type SQSClient,
} from '@aws-sdk/client-sqs';

import { handleMessage, type MessageHandler } from '../messaging/message-outcome';

export type { MessageHandler } from '../messaging/message-outcome';

interface Logger {
  info: (message: string, fields?: Record<string, unknown>) => void;
  error: (message: string, fields?: Record<string, unknown>) => void;
}

/**
 * Consumes a service queue (PLANNING §3.2 and §3.3). For each message:
 * - valid and handled: deleted;
 * - the handler asks to retry later (the market had nothing to sell): hidden for that long;
 * - the handler fails (a transient error): hidden for a short, growing delay, then retried;
 * - invalid (not JSON or breaks the contract): moved to the DLQ, since retrying never helps.
 *
 * A standard queue is read in batches of 10, all handled at once. A FIFO queue is read by
 * several workers that take one message each: the queue never hands over a message of a group
 * while another of the same group is in flight, so there is one purchase per ingredient at a
 * time, and different ingredients are bought in parallel by different workers.
 */
export class SqsConsumer {
  private readonly client: SQSClient;
  private readonly queueUrl: string;
  private readonly dlqUrl: string;
  private readonly handle: MessageHandler;
  private readonly logger: Logger;
  private readonly waitTimeSeconds: number;
  private readonly fifo: boolean;
  private readonly workers: number;

  constructor(deps: {
    client: SQSClient;
    queueUrl: string;
    dlqUrl: string;
    handle: MessageHandler;
    logger: Logger;
    waitTimeSeconds?: number;
    workers?: number;
  }) {
    this.client = deps.client;
    this.queueUrl = deps.queueUrl;
    this.dlqUrl = deps.dlqUrl;
    this.handle = deps.handle;
    this.logger = deps.logger;
    // Short enough that a stopping process finishes its poll within the shutdown grace period.
    this.waitTimeSeconds = deps.waitTimeSeconds ?? 5;
    this.fifo = deps.queueUrl.endsWith('.fifo');
    this.workers = deps.workers ?? (this.fifo ? 5 : 1);
  }

  /**
   * Polls until the signal aborts; long polling keeps idle queues cheap. On shutdown each worker
   * finishes the message in hand before it stops, so no message is left hidden: cancelling the
   * poll instead would not help, since SQS still hands the message to the abandoned request.
   */
  async run(signal: AbortSignal): Promise<void> {
    const worker = async () => {
      while (!signal.aborted) {
        try {
          await this.consumeOnce();
        } catch (error) {
          this.logger.error('Could not poll the queue', { error, queueUrl: this.queueUrl });
        }
      }
    };
    await Promise.all(Array.from({ length: this.workers }, worker));
  }

  /** Receives one batch (one message on a FIFO queue) and handles it. */
  async consumeOnce(): Promise<number> {
    const { Messages = [] } = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: this.fifo ? 1 : 10,
        WaitTimeSeconds: this.waitTimeSeconds,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }),
    );
    await Promise.all(Messages.map((message) => this.process(message)));
    return Messages.length;
  }

  private async process(message: Message): Promise<void> {
    const receives = Number(message.Attributes?.ApproximateReceiveCount ?? 1);
    const outcome = await handleMessage(message.Body ?? '', receives, this.handle);
    switch (outcome.kind) {
      case 'done':
        await this.delete(message);
        return;
      case 'retry':
        if (outcome.error) {
          this.logger.error('Message failed, it will be retried', {
            error: outcome.error,
            type: outcome.event.type,
            correlationId: outcome.event.correlationId,
            retryInSeconds: outcome.seconds,
          });
        }
        await this.hide(message, outcome.seconds);
        return;
      case 'invalid':
        this.logger.error('Invalid message moved to the DLQ', {
          error: outcome.error,
          messageId: message.MessageId,
        });
        await this.moveToDlq(message);
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
