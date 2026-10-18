import { setTimeout as sleep } from 'node:timers/promises';

import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import type {
  Batch,
  OrderKey,
  OrderRecord,
  OrdersRepository,
  OrderUpdate,
} from '../application/ports';
import { ORDER_STATUSES, type OrderStatus } from '../domain/order-status';

type TransactItems = NonNullable<
  ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']
>;

/** The orders of a workday are spread over this many partitions, so none of them gets hot. */
const SHARDS = 10;
/** DynamoDB accepts up to 100 items per transaction: 99 orders plus the counter. */
const ORDERS_PER_TRANSACTION = 99;
const MAX_ATTEMPTS = 50;

const shardOf = (orderId: string) => Number.parseInt(orderId.slice(0, 4), 16) % SHARDS;
const rankOf = (status: OrderStatus) => ORDER_STATUSES.indexOf(status);

const keys = {
  activeWorkday: { pk: 'WORKDAY', sk: 'ACTIVE' },
  pendingWorkday: (workdayId: string) => ({ pk: 'PENDING_WORKDAY', sk: workdayId }),
  inProgress: (workdayId: string) => ({ pk: `WORKDAY#${workdayId}`, sk: 'IN_PROGRESS' }),
  batch: (batchId: string) => ({ pk: `BATCH#${batchId}`, sk: 'BATCH' }),
  ordersOf: (workdayId: string, shard: number) => `WORKDAY#${workdayId}#ORDERS#${String(shard)}`,
  order: ({ orderId, workdayId }: OrderKey) => ({
    pk: keys.ordersOf(workdayId, shardOf(orderId)),
    sk: `ORDER#${orderId}`,
  }),
};

/**
 * DynamoDB adapter of the orders port. Orders live in their workday, spread over SHARDS
 * partitions, so a workday is listed with a handful of queries and never with a scan. A
 * counter per workday, updated in the same transaction as each order, answers "are there
 * orders in progress?" with a single consistent read (PLANNING §3.7).
 */
export class DynamoOrders implements OrdersRepository {
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(deps: { client: DynamoDBDocumentClient; tableName: string }) {
    this.client = deps.client;
    this.tableName = deps.tableName;
  }

  async activeWorkday(): Promise<string | undefined> {
    const item = await this.get(keys.activeWorkday);
    return item?.['workdayId'] as string | undefined;
  }

  async countInProgress(workdayId: string): Promise<number> {
    const item = await this.get(keys.inProgress(workdayId));
    return (item?.['count'] as number | undefined) ?? 0;
  }

  async switchWorkday(from: string | undefined, to: string): Promise<boolean> {
    const reasons = await this.transact([
      {
        Put: {
          TableName: this.tableName,
          Item: { ...keys.activeWorkday, workdayId: to },
          ...(from === undefined
            ? { ConditionExpression: 'attribute_not_exists(pk)' }
            : {
                ConditionExpression: 'workdayId = :from',
                ExpressionAttributeValues: { ':from': from },
              }),
        },
      },
      { Put: { TableName: this.tableName, Item: { ...keys.pendingWorkday(to), workdayId: to } } },
    ]);
    return !reasons;
  }

  async pendingWorkdays(): Promise<string[]> {
    return (await this.query('PENDING_WORKDAY')).map((item) => item['workdayId'] as string);
  }

  async markWorkdayAnnounced(workdayId: string): Promise<void> {
    await this.client.send(
      new DeleteCommand({ TableName: this.tableName, Key: keys.pendingWorkday(workdayId) }),
    );
  }

  async createBatch(batch: Batch): Promise<Batch> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: { ...keys.batch(batch.batchId), ...batch },
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
      return batch;
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) {
        throw error;
      }
      const { batchId, workdayId, orderIds } = (await this.get(keys.batch(batch.batchId))) as Batch;
      return { batchId, workdayId, orderIds };
    }
  }

  async saveNewOrders(orders: readonly OrderRecord[]): Promise<void> {
    // Each transaction adds to the counter of one workday, so orders are grouped by workday.
    for (const ofWorkday of Map.groupBy(orders, ({ workdayId }) => workdayId).values()) {
      await this.saveOrdersOf(ofWorkday);
    }
  }

  private async saveOrdersOf(orders: readonly OrderRecord[]): Promise<void> {
    for (let start = 0; start < orders.length; start += ORDERS_PER_TRANSACTION) {
      const chunk = orders.slice(start, start + ORDERS_PER_TRANSACTION);
      // The fast path writes the whole chunk at once; if any order already exists (a retry),
      // the chunk is cancelled and each order is written on its own, skipping the existing.
      if (await this.insertOrders(chunk)) {
        for (const order of chunk) {
          await this.insertOrders([order]);
        }
      }
    }
  }

  async updateOrder(order: OrderKey, { status, recipe, waiting }: OrderUpdate): Promise<void> {
    if (recipe) {
      // Kept whenever it arrives: the recipe never changes, whatever the order of the events.
      await this.client
        .send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: keys.order(order),
            UpdateExpression: 'SET recipeId = :recipeId, recipeName = :recipeName',
            ConditionExpression: 'attribute_exists(pk)',
            ExpressionAttributeValues: {
              ':recipeId': recipe.recipeId,
              ':recipeName': recipe.recipeName,
            },
          }),
        )
        .catch((error: unknown) => {
          if (!(error instanceof ConditionalCheckFailedException)) {
            throw error;
          }
        });
    }

    const assignments = ['#status = :status', 'statusRank = :rank'];
    const values: Record<string, unknown> = { ':status': status, ':rank': rankOf(status) };
    if (waiting) {
      assignments.push('#missing = :missing', 'waitingSince = :since');
      values[':missing'] = waiting.missing;
      values[':since'] = waiting.since;
    }
    // Only forward (§3.6): a late or repeated event fails the condition and changes nothing,
    // and the delivery leaves the in-progress counter in the same transaction, exactly once.
    await this.transact([
      {
        Update: {
          TableName: this.tableName,
          Key: keys.order(order),
          UpdateExpression: `SET ${assignments.join(', ')}`,
          ConditionExpression: 'statusRank < :rank',
          // status and missing are reserved words in DynamoDB expressions.
          ExpressionAttributeNames: {
            '#status': 'status',
            ...(waiting && { '#missing': 'missing' }),
          },
          ExpressionAttributeValues: values,
        },
      },
      ...(status === 'DELIVERED' ? [this.addToCounter(order.workdayId, -1)] : []),
    ]);
  }

  async listOrders(workdayId: string): Promise<OrderRecord[]> {
    const shards = await Promise.all(
      Array.from({ length: SHARDS }, (_, shard) => this.query(keys.ordersOf(workdayId, shard))),
    );
    return shards.flat().map((item) => {
      const order = item as unknown as OrderRecord;
      return {
        orderId: order.orderId,
        batchId: order.batchId,
        workdayId: order.workdayId,
        status: order.status,
        ...(order.recipeId !== undefined && {
          recipeId: order.recipeId,
          recipeName: order.recipeName,
        }),
        ...(order.missing !== undefined && {
          missing: order.missing,
          waitingSince: order.waitingSince,
        }),
      };
    });
  }

  /** Inserts the orders that do not exist yet; returns the reasons if the write was cancelled. */
  private insertOrders(orders: readonly OrderRecord[]) {
    const [first] = orders;
    if (!first) {
      return Promise.resolve(undefined);
    }
    return this.transact([
      ...orders.map((order) => ({
        Put: {
          TableName: this.tableName,
          Item: { ...keys.order(order), ...order, statusRank: rankOf(order.status) },
          ConditionExpression: 'attribute_not_exists(pk)',
        },
      })),
      this.addToCounter(first.workdayId, orders.length),
    ]);
  }

  private addToCounter(workdayId: string, amount: number) {
    return {
      Update: {
        TableName: this.tableName,
        Key: keys.inProgress(workdayId),
        UpdateExpression: 'ADD #count :amount',
        ExpressionAttributeNames: { '#count': 'count' },
        ExpressionAttributeValues: { ':amount': amount },
      },
    };
  }

  /**
   * Runs the transaction, retrying while DynamoDB reports a conflict with another transaction
   * on the same items. Returns undefined on success, or why each item failed otherwise.
   */
  private async transact(items: TransactItems): Promise<(string | undefined)[] | undefined> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.client.send(new TransactWriteCommand({ TransactItems: items }));
        return undefined;
      } catch (error) {
        if (!(error instanceof TransactionCanceledException)) {
          throw error;
        }
        const reasons = (error.CancellationReasons ?? []).map(({ Code }) => Code);
        if (!reasons.includes('TransactionConflict') || attempt === MAX_ATTEMPTS) {
          return reasons;
        }
        await sleep(Math.random() * 20 * attempt);
      }
    }
  }

  private async get(key: { pk: string; sk: string }) {
    const { Item } = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }),
    );
    return Item;
  }

  private async query(pk: string): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const page = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': pk },
          ExclusiveStartKey: start,
          ConsistentRead: true,
        }),
      );
      items.push(...(page.Items ?? []));
      start = page.LastEvaluatedKey;
    } while (start);
    return items;
  }
}
