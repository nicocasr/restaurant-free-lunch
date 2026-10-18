import { createTestTable } from '@alegra-lunch/testing';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { DynamoPurchases } from '../../src/infrastructure/dynamo-purchases';
import { purchaseRepositoryContract } from '../contract/purchase-repository.contract';

const dynamo = new DynamoDBClient({});
const client = DynamoDBDocumentClient.from(dynamo);

afterAll(() => {
  dynamo.destroy();
});

purchaseRepositoryContract('DynamoPurchases', async () => {
  const { tableName, drop } = await createTestTable(dynamo, 'purchases');
  return { repository: new DynamoPurchases({ client, tableName }), dispose: drop };
});
