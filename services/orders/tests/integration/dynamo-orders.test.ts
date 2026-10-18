import { createTestTable } from '@alegra-lunch/testing';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { DynamoOrders } from '../../src/infrastructure/dynamo-orders';
import { ordersRepositoryContract } from '../contract/orders-repository.contract';

const dynamo = new DynamoDBClient({});
const client = DynamoDBDocumentClient.from(dynamo);

afterAll(() => {
  dynamo.destroy();
});

ordersRepositoryContract('DynamoOrders', async () => {
  const { tableName, drop } = await createTestTable(dynamo, 'orders');
  return { repository: new DynamoOrders({ client, tableName }), dispose: drop };
});
