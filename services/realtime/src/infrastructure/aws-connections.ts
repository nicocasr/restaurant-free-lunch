import {
  GoneException,
  PostToConnectionCommand,
  type ApiGatewayManagementApiClient,
} from '@aws-sdk/client-apigatewaymanagementapi';
import {
  DeleteCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import type { Connections } from '../application/ports';

const key = (connectionId: string) => ({ pk: 'CONNECTION', sk: connectionId });

/**
 * AWS adapter of the connections port (PLANNING §2): API Gateway WebSocket keeps the sockets,
 * the connections table remembers who is connected, since each Lambda is independent.
 */
export class AwsConnections implements Connections {
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;
  private readonly api: Pick<ApiGatewayManagementApiClient, 'send'>;

  constructor(deps: {
    client: DynamoDBDocumentClient;
    tableName: string;
    api: Pick<ApiGatewayManagementApiClient, 'send'>;
  }) {
    this.client = deps.client;
    this.tableName = deps.tableName;
    this.api = deps.api;
  }

  async add(connectionId: string): Promise<void> {
    await this.client.send(
      new PutCommand({ TableName: this.tableName, Item: { ...key(connectionId), connectionId } }),
    );
  }

  async list(): Promise<string[]> {
    const ids: string[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const page = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': 'CONNECTION' },
          ExclusiveStartKey: start,
        }),
      );
      ids.push(...(page.Items ?? []).map((item) => item['connectionId'] as string));
      start = page.LastEvaluatedKey;
    } while (start);
    return ids;
  }

  async send(connectionId: string, message: string): Promise<'sent' | 'gone'> {
    try {
      await this.api.send(
        new PostToConnectionCommand({ ConnectionId: connectionId, Data: message }),
      );
      return 'sent';
    } catch (error) {
      // The dashboard closed without saying goodbye: API Gateway no longer knows it.
      if (error instanceof GoneException) {
        return 'gone';
      }
      throw error;
    }
  }

  async remove(connectionId: string): Promise<void> {
    await this.client.send(
      new DeleteCommand({ TableName: this.tableName, Key: key(connectionId) }),
    );
  }
}
