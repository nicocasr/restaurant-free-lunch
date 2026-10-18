import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import type { PurchaseRecord, PurchaseRepository, Sale, Shortage } from '../application/ports';
import { startPurchase, type PurchaseProgress } from '../domain/purchase-progress';

const keys = {
  // The purchase of a shortage and its sales share a partition: its full history in one query.
  purchase: (shortageId: string) => ({ pk: `PURCHASE#${shortageId}`, sk: 'PURCHASE' }),
  sale: (sale: Sale) => ({ pk: `PURCHASE#${sale.shortageId}`, sk: `SALE#${sale.purchaseId}` }),
  pendingSale: (purchaseId: string) => ({ pk: 'PENDING_SALE', sk: purchaseId }),
  // A copy per workday: the purchase history of a workday in one query, without a scan.
  saleOfWorkday: (sale: Sale) => ({ pk: `WORKDAY#${sale.workdayId}#SALES`, sk: sale.purchaseId }),
};

/** DynamoDB adapter of the purchases port: the purchase history of PLANNING §3.1. */
export class DynamoPurchases implements PurchaseRepository {
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(deps: { client: DynamoDBDocumentClient; tableName: string }) {
    this.client = deps.client;
    this.tableName = deps.tableName;
  }

  async startOrResume(shortage: Shortage): Promise<PurchaseRecord> {
    const { quantity, ...rest } = shortage;
    const record: PurchaseRecord = { ...rest, progress: startPurchase(quantity) };
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: { ...keys.purchase(shortage.shortageId), ...record },
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
      return record;
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) {
        throw error;
      }
      const { Item } = await this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: keys.purchase(shortage.shortageId),
          ConsistentRead: true,
        }),
      );
      const { shortageId, workdayId, ingredient, progress } = Item as PurchaseRecord;
      return { shortageId, workdayId, ingredient, progress };
    }
  }

  async recordSale(sale: Sale, progress: PurchaseProgress): Promise<void> {
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: this.tableName, Item: { ...keys.sale(sale), ...sale } } },
          { Put: { TableName: this.tableName, Item: { ...keys.saleOfWorkday(sale), ...sale } } },
          {
            Put: {
              TableName: this.tableName,
              Item: { ...keys.pendingSale(sale.purchaseId), ...sale },
            },
          },
          {
            Update: {
              TableName: this.tableName,
              Key: keys.purchase(sale.shortageId),
              UpdateExpression: 'SET progress = :progress',
              ExpressionAttributeValues: { ':progress': progress },
            },
          },
        ],
      }),
    );
  }

  async saveProgress(shortageId: string, progress: PurchaseProgress): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: keys.purchase(shortageId),
        UpdateExpression: 'SET progress = :progress',
        ExpressionAttributeValues: { ':progress': progress },
      }),
    );
  }

  async pendingSales(shortageId: string): Promise<Sale[]> {
    const sales: Sale[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const page = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': 'PENDING_SALE' },
          ExclusiveStartKey: start,
          ConsistentRead: true,
        }),
      );
      for (const item of (page.Items ?? []) as Sale[]) {
        if (item.shortageId === shortageId) {
          const { purchaseId, workdayId, ingredient, quantity } = item;
          sales.push({ purchaseId, shortageId, workdayId, ingredient, quantity });
        }
      }
      start = page.LastEvaluatedKey;
    } while (start);
    return sales;
  }

  async listSales(workdayId: string): Promise<Sale[]> {
    const sales: Sale[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const page = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': `WORKDAY#${workdayId}#SALES` },
          ExclusiveStartKey: start,
        }),
      );
      for (const { purchaseId, shortageId, ingredient, quantity } of (page.Items ?? []) as Sale[]) {
        sales.push({ purchaseId, shortageId, workdayId, ingredient, quantity });
      }
      start = page.LastEvaluatedKey;
    } while (start);
    return sales;
  }

  async markSalePublished(purchaseId: string): Promise<void> {
    await this.client.send(
      new DeleteCommand({ TableName: this.tableName, Key: keys.pendingSale(purchaseId) }),
    );
  }
}
