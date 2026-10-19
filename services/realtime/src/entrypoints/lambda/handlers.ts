import { parseEvent, type DomainEvent } from '@alegra-lunch/contracts';
import { createLogger, loadConfig } from '@alegra-lunch/shared';
import { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyWebsocketEventV2, SQSEvent } from 'aws-lambda';
import { z } from 'zod';

import { broadcastEvents } from '../../application/broadcast-events';
import { AwsConnections } from '../../infrastructure/aws-connections';

const config = loadConfig({
  TABLE_NAME: z.string().min(1),
  // https://<api-id>.execute-api.<region>.amazonaws.com/<stage>, to post to the dashboards.
  WEBSOCKET_MANAGEMENT_URL: z.url(),
});
const logger = createLogger({ service: 'realtime' });

const connections = new AwsConnections({
  client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  tableName: config.TABLE_NAME,
  api: new ApiGatewayManagementApiClient({ endpoint: config.WEBSOCKET_MANAGEMENT_URL }),
});
const broadcast = broadcastEvents({ connections });

/** $connect: a dashboard opened the page. */
export async function connect(event: APIGatewayProxyWebsocketEventV2) {
  await connections.add(event.requestContext.connectionId);
  return { statusCode: 200 };
}

/** $disconnect: a dashboard closed the page. */
export async function disconnect(event: APIGatewayProxyWebsocketEventV2) {
  await connections.remove(event.requestContext.connectionId);
  return { statusCode: 200 };
}

/**
 * Triggered by the realtime queue with a batching window: the queue gathers the events of
 * about a second and they go out as one message, like the batcher of the container (§2).
 * Delivery to the dashboard is best effort: it reloads its data when it reconnects, so a
 * malformed event is just skipped instead of retried.
 */
export async function queue(event: SQSEvent): Promise<void> {
  const events: DomainEvent[] = [];
  for (const record of event.Records) {
    try {
      events.push(parseEvent(JSON.parse(record.body)));
    } catch (error) {
      logger.error('Skipped an invalid event', { error, messageId: record.messageId });
    }
  }
  if (events.length > 0) {
    await broadcast(events);
  }
}
