import { randomUUID } from 'node:crypto';

import {
  CreateTableCommand,
  DeleteTableCommand,
  type DynamoDBClient,
} from '@aws-sdk/client-dynamodb';

/**
 * Creates a fresh single-table (pk + sk) table for one integration test, so every test is
 * independent of the others, and returns its name with a function that deletes it.
 */
export async function createTestTable(
  dynamo: DynamoDBClient,
  prefix: string,
): Promise<{ tableName: string; drop: () => Promise<void> }> {
  const tableName = `${prefix}-test-${randomUUID()}`;
  await dynamo.send(
    new CreateTableCommand({
      TableName: tableName,
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    }),
  );
  return {
    tableName,
    drop: async () => {
      await dynamo.send(new DeleteTableCommand({ TableName: tableName }));
    },
  };
}
