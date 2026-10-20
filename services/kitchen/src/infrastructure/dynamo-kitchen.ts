import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import type { Assignment, KitchenRepository } from '../application/ports';

// One partition per order spreads thousands of assignments across DynamoDB partitions.
const key = (orderId: string) => ({ pk: `ASSIGNMENT#${orderId}`, sk: 'ASSIGNMENT' });

/** DynamoDB adapter of the kitchen port. The database decides which draw wins (§3.4). */
export class DynamoKitchen implements KitchenRepository {
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(deps: { client: DynamoDBDocumentClient; tableName: string }) {
    this.client = deps.client;
    this.tableName = deps.tableName;
  }

  async assignOnce(assignment: Assignment): Promise<Assignment> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: { ...key(assignment.orderId), ...assignment },
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
      return assignment;
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) {
        throw error;
      }
      // Another attempt assigned the order first: its recipe is the one that counts.
      return (await this.findAssignment(assignment.orderId)) as Assignment;
    }
  }

  async findAssignment(orderId: string): Promise<Assignment | undefined> {
    const { Item } = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: key(orderId), ConsistentRead: true }),
    );
    if (!Item) {
      return undefined;
    }
    const { workdayId, recipeId } = Item as Assignment;
    return { orderId, workdayId, recipeId };
  }
}
