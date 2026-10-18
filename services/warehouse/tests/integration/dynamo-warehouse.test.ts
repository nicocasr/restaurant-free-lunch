import { createTestTable } from '@alegra-lunch/testing';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { DynamoWarehouse } from '../../src/infrastructure/dynamo-warehouse';
import { warehouseRepositoryContract } from '../contract/warehouse-repository.contract';

const dynamo = new DynamoDBClient({});
const client = DynamoDBDocumentClient.from(dynamo);

afterAll(() => {
  dynamo.destroy();
});

warehouseRepositoryContract('DynamoWarehouse', async () => {
  const { tableName, drop } = await createTestTable(dynamo, 'warehouse');
  return { repository: new DynamoWarehouse({ client, tableName }), dispose: drop };
});
