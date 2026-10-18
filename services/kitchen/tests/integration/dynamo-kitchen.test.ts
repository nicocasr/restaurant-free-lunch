import { createTestTable } from '@alegra-lunch/testing';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { DynamoKitchen } from '../../src/infrastructure/dynamo-kitchen';
import { kitchenRepositoryContract } from '../contract/kitchen-repository.contract';

const dynamo = new DynamoDBClient({});
const client = DynamoDBDocumentClient.from(dynamo);

afterAll(() => {
  dynamo.destroy();
});

kitchenRepositoryContract('DynamoKitchen', async () => {
  const { tableName, drop } = await createTestTable(dynamo, 'kitchen');
  return { repository: new DynamoKitchen({ client, tableName }), dispose: drop };
});
