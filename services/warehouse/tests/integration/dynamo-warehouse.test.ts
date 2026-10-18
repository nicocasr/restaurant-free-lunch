import { randomUUID } from 'node:crypto';

import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { DynamoWarehouse } from '../../src/infrastructure/dynamo-warehouse';
import { warehouseRepositoryContract } from '../contract/warehouse-repository.contract';

const dynamo = new DynamoDBClient({});
const documents = DynamoDBDocumentClient.from(dynamo);

afterAll(() => {
  dynamo.destroy();
});

// A fresh table per test keeps every test independent of the others.
warehouseRepositoryContract('DynamoWarehouse', async () => {
  const tableName = `warehouse-test-${randomUUID()}`;
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
    repository: new DynamoWarehouse({ client: documents, tableName }),
    dispose: async () => {
      await dynamo.send(new DeleteTableCommand({ TableName: tableName }));
    },
  };
});
