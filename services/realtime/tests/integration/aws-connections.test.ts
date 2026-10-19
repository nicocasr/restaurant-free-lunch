import { createTestTable } from '@alegra-lunch/testing';
import { GoneException } from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { AwsConnections } from '../../src/infrastructure/aws-connections';

const dynamo = new DynamoDBClient({});
const client = DynamoDBDocumentClient.from(dynamo);

afterAll(() => {
  dynamo.destroy();
});

/** API Gateway's management API, faked: LocalStack community does not emulate WebSockets. */
function fakeManagementApi(goneIds: string[] = []) {
  const posted: { connectionId: string; data: string }[] = [];
  return {
    posted,
    api: {
      send: (command: { input: { ConnectionId?: string; Data?: unknown } }) => {
        const connectionId = command.input.ConnectionId ?? '';
        if (goneIds.includes(connectionId)) {
          return Promise.reject(new GoneException({ message: 'Gone', $metadata: {} }));
        }
        posted.push({ connectionId, data: String(command.input.Data) });
        return Promise.resolve({});
      },
    },
  };
}

describe('AwsConnections', () => {
  let drop: () => Promise<void>;
  let tableName: string;

  beforeEach(async () => {
    ({ tableName, drop } = await createTestTable(dynamo, 'connections'));
  });

  afterEach(async () => {
    await drop();
  });

  it('keeps the dashboards that connect until they disconnect', async () => {
    const connections = new AwsConnections({ client, tableName, api: fakeManagementApi().api });

    await connections.add('tab-1');
    await connections.add('tab-2');
    await connections.remove('tab-1');

    expect(await connections.list()).toEqual(['tab-2']);
  });

  it('posts a message to a connected dashboard', async () => {
    const management = fakeManagementApi();
    const connections = new AwsConnections({ client, tableName, api: management.api });

    expect(await connections.send('tab-1', '{"type":"events","events":[]}')).toBe('sent');
    expect(management.posted).toEqual([
      { connectionId: 'tab-1', data: '{"type":"events","events":[]}' },
    ]);
  });

  it('reports a dashboard that closed without disconnecting as gone', async () => {
    const connections = new AwsConnections({
      client,
      tableName,
      api: fakeManagementApi(['closed-tab']).api,
    });

    expect(await connections.send('closed-tab', 'hello')).toBe('gone');
  });
});
