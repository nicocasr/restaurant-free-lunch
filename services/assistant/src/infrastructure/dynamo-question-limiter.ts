import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { TransactWriteCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import type { QuestionLimiter } from '../application/ports';

/**
 * Counts the questions of the minute and of the day in DynamoDB (PLANNING §5). Both counters
 * go up in one transaction, each only if it is below its limit: Lambdas share no memory, so
 * the database is the only place where every instance sees the same count (§3.4). Expired
 * counters are deleted by the table's TTL.
 */
export class DynamoQuestionLimiter implements QuestionLimiter {
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;
  private readonly perMinute: number;
  private readonly perDay: number;

  constructor(deps: {
    client: DynamoDBDocumentClient;
    tableName: string;
    perMinute: number;
    perDay: number;
  }) {
    this.client = deps.client;
    this.tableName = deps.tableName;
    this.perMinute = deps.perMinute;
    this.perDay = deps.perDay;
  }

  async take(now: Date): Promise<boolean> {
    const iso = now.toISOString();
    const seconds = Math.floor(now.getTime() / 1_000);
    const counter = (sk: string, max: number, expiresAt: number) => ({
      Update: {
        TableName: this.tableName,
        Key: { pk: 'QUESTIONS', sk },
        UpdateExpression: 'ADD #count :one SET expiresAt = :expiresAt',
        ConditionExpression: 'attribute_not_exists(#count) OR #count < :max',
        ExpressionAttributeNames: { '#count': 'count' },
        ExpressionAttributeValues: { ':one': 1, ':max': max, ':expiresAt': expiresAt },
      },
    });

    const transaction = new TransactWriteCommand({
      TransactItems: [
        counter(`MINUTE#${iso.slice(0, 16)}`, this.perMinute, seconds + 120),
        counter(`DAY#${iso.slice(0, 10)}`, this.perDay, seconds + 2 * 86_400),
      ],
    });

    for (let attempt = 1; ; attempt++) {
      try {
        await this.client.send(transaction);
        return true;
      } catch (error) {
        if (!(error instanceof TransactionCanceledException)) {
          throw error;
        }
        const full = error.CancellationReasons?.some(
          ({ Code }) => Code === 'ConditionalCheckFailed',
        );
        if (full) {
          return false;
        }
        // Another question updated the counter at the same moment: this one still has room.
        if (attempt === MAX_ATTEMPTS) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 50 * attempt));
      }
    }
  }
}

/** Questions arriving together collide on the counter; a few short retries sort them out. */
const MAX_ATTEMPTS = 5;
