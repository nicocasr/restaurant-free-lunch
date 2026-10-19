import {
  ChangeMessageVisibilityCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';

import { handleMessage, type MessageHandler } from '../messaging/message-outcome';

interface Logger {
  error: (message: string, fields?: Record<string, unknown>) => void;
}

/** arn:aws:sqs:<region>:<account>:<name> → https://sqs.<region>.amazonaws.com/<account>/<name> */
function queueUrlOf(arn: string): string {
  const [, , , region, account, name] = arn.split(':');
  return `https://sqs.${String(region)}.amazonaws.com/${String(account)}/${String(name)}`;
}

/**
 * Lambda adapter of a service queue: the same outcomes as the container consumer, carried out
 * the Lambda way (PLANNING §3.3). Lambda deletes the messages that are not reported as failed,
 * so a message to retry is hidden for its delay and reported in batchItemFailures, and an
 * invalid one goes to the DLQ and is let go.
 */
export function createSqsHandler(deps: {
  client: Pick<SQSClient, 'send'>;
  dlqUrl: string;
  handle: MessageHandler;
  logger: Logger;
}) {
  const process = async (record: SQSRecord): Promise<boolean> => {
    const receives = Number(record.attributes.ApproximateReceiveCount);
    const outcome = await handleMessage(record.body, receives, deps.handle);

    if (outcome.kind === 'done') {
      return true;
    }
    if (outcome.kind === 'invalid') {
      deps.logger.error('Invalid message moved to the DLQ', {
        error: outcome.error,
        messageId: record.messageId,
      });
      const fifo = deps.dlqUrl.endsWith('.fifo');
      await deps.client.send(
        new SendMessageCommand({
          QueueUrl: deps.dlqUrl,
          MessageBody: record.body,
          ...(fifo && { MessageGroupId: 'invalid', MessageDeduplicationId: record.messageId }),
        }),
      );
      return true;
    }

    if (outcome.error) {
      deps.logger.error('Message failed, it will be retried', {
        error: outcome.error,
        type: outcome.event.type,
        correlationId: outcome.event.correlationId,
        retryInSeconds: outcome.seconds,
      });
    }
    await deps.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrlOf(record.eventSourceARN),
        ReceiptHandle: record.receiptHandle,
        VisibilityTimeout: outcome.seconds,
      }),
    );
    return false;
  };

  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const handled = await Promise.all(event.Records.map(process));
    return {
      batchItemFailures: event.Records.filter((_, index) => !handled[index]).map(
        ({ messageId }) => ({ itemIdentifier: messageId }),
      ),
    };
  };
}
