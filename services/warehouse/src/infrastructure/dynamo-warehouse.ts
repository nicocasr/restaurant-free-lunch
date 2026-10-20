import { setTimeout as sleep } from 'node:timers/promises';

import { INGREDIENTS, type Ingredient, type IngredientQuantity } from '@alegra-lunch/contracts';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import type {
  ApplyPurchaseOutcome,
  IngredientSnapshot,
  PendingReservation,
  Purchase,
  ReserveFromWaitingOutcome,
  ReserveOutcome,
  Shortage,
  WarehouseRepository,
  WriteOutcome,
} from '../application/ports';
import { reserve } from '../domain/reservation';
import type { Stock } from '../domain/stock';
import type { WaitingOrder } from '../domain/waiting-list';

type TransactItems = NonNullable<
  ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']
>;

interface IngredientItem {
  stock?: number;
  waitingNeed?: number;
  inFlight?: number;
  version?: number;
}

/** Why each item of a cancelled transaction failed, in the order the items were sent. */
type Reasons = (string | undefined)[];

const CONFLICT = 'TransactionConflict';
const CONDITION_FAILED = 'ConditionalCheckFailed';
const MAX_ATTEMPTS = 50;

const keys = {
  ingredient: (ingredient: Ingredient) => ({ pk: 'INGREDIENT', sk: ingredient }),
  activeWorkday: { pk: 'WORKDAY', sk: 'ACTIVE' },
  startedWorkday: (workdayId: string) => ({ pk: 'WORKDAY', sk: `STARTED#${workdayId}` }),
  reservation: (orderId: string) => ({ pk: 'RESERVATION', sk: orderId }),
  pendingReservation: (orderId: string) => ({ pk: 'PENDING_RESERVATION', sk: orderId }),
  // Sorted by arrival, so the waiting list reads oldest first.
  waiting: (order: WaitingOrder) => ({
    pk: 'WAITING',
    sk: `${order.waitingSince}#${order.orderId}`,
  }),
  purchase: (purchaseId: string) => ({ pk: 'PURCHASE', sk: purchaseId }),
  shortage: (shortageId: string) => ({ pk: 'SHORTAGE', sk: shortageId }),
};

/**
 * DynamoDB adapter of the warehouse port (PLANNING §3.3 and §3.4). The database is the
 * arbiter: every rule that must hold under concurrency is a condition of the write itself.
 */
export class DynamoWarehouse implements WarehouseRepository {
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(deps: { client: DynamoDBDocumentClient; tableName: string }) {
    this.client = deps.client;
    this.tableName = deps.tableName;
  }

  async activeWorkday(): Promise<string | undefined> {
    const { Item } = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: keys.activeWorkday }),
    );
    return Item?.['workdayId'] as string | undefined;
  }

  async startWorkday(workdayId: string, stock: Stock): Promise<WriteOutcome> {
    const reasons = await this.transact([
      this.put(keys.startedWorkday(workdayId), {}, 'attribute_not_exists(pk)'),
      this.put(keys.activeWorkday, { workdayId }),
      ...INGREDIENTS.map((ingredient) => ({
        Update: {
          TableName: this.tableName,
          Key: keys.ingredient(ingredient),
          UpdateExpression:
            'SET stock = :stock, waitingNeed = :zero, inFlight = :zero ADD version :one',
          ExpressionAttributeValues: { ':stock': stock[ingredient], ':zero': 0, ':one': 1 },
        },
      })),
    ]);
    if (reasons) {
      return 'duplicate';
    }
    // Shortages are deleted once published, so every one left is unpublished.
    for (const { shortageId } of await this.query<Shortage>('SHORTAGE')) {
      await this.delete(keys.shortage(shortageId));
    }
    return 'applied';
  }

  async reserve(orderId: string, needs: readonly IngredientQuantity[]): Promise<ReserveOutcome> {
    for (;;) {
      const reasons = await this.transact([
        ...needs.map((need) => this.deduct(need)),
        this.put(keys.reservation(orderId), {}, 'attribute_not_exists(pk)'),
      ]);
      if (!reasons) {
        return { status: 'reserved' };
      }
      if (reasons[needs.length] === CONDITION_FAILED) {
        return { status: 'duplicate' };
      }
      // A unit was short: report it, unless another order freed stock meanwhile.
      const result = reserve(await this.readStock(), needs);
      if (!result.reserved) {
        return { status: 'insufficient', missing: result.missing };
      }
    }
  }

  async enqueue(order: WaitingOrder): Promise<WriteOutcome> {
    const reasons = await this.transact([
      this.put(keys.waiting(order), { ...order }, 'attribute_not_exists(pk)'),
      ...order.needs.map(({ ingredient, quantity }) => ({
        Update: {
          TableName: this.tableName,
          Key: keys.ingredient(ingredient),
          UpdateExpression: 'ADD waitingNeed :quantity, version :one',
          ExpressionAttributeValues: { ':quantity': quantity, ':one': 1 },
        },
      })),
    ]);
    return reasons ? 'duplicate' : 'applied';
  }

  async reserveFromWaiting(order: WaitingOrder): Promise<ReserveFromWaitingOutcome> {
    const reasons = await this.transact([
      {
        Delete: {
          TableName: this.tableName,
          Key: keys.waiting(order),
          ConditionExpression: 'attribute_exists(pk)',
        },
      },
      ...order.needs.map((need) => this.deduct(need, { fromWaiting: true })),
      this.put(keys.reservation(order.orderId), {}, 'attribute_not_exists(pk)'),
      this.put(keys.pendingReservation(order.orderId), {
        orderId: order.orderId,
        workdayId: order.workdayId,
      }),
    ]);
    if (!reasons) {
      return 'reserved';
    }
    const stockShort = reasons.slice(1, 1 + order.needs.length).includes(CONDITION_FAILED);
    return reasons[0] !== CONDITION_FAILED && stockShort ? 'insufficient' : 'not-waiting';
  }

  async waitingOrders(): Promise<WaitingOrder[]> {
    return (await this.query<WaitingOrder>('WAITING')).map(
      ({ orderId, workdayId, waitingSince, needs }) => ({
        orderId,
        workdayId,
        waitingSince,
        needs,
      }),
    );
  }

  async pendingReservations(): Promise<PendingReservation[]> {
    return (await this.query<PendingReservation>('PENDING_RESERVATION')).map(
      ({ orderId, workdayId }) => ({ orderId, workdayId }),
    );
  }

  async markReservationPublished(orderId: string): Promise<void> {
    await this.delete(keys.pendingReservation(orderId));
  }

  async readStock(): Promise<Stock> {
    const items = await this.query<IngredientItem & { sk: Ingredient }>('INGREDIENT');
    const stock = Object.fromEntries(INGREDIENTS.map((ingredient) => [ingredient, 0])) as Record<
      Ingredient,
      number
    >;
    for (const item of items) {
      stock[item.sk] = item.stock ?? 0;
    }
    return stock;
  }

  async applyPurchase({
    purchaseId,
    workdayId,
    ingredient,
    quantity,
  }: Purchase): Promise<ApplyPurchaseOutcome> {
    // DynamoDB expressions have no max(), so in-flight units are computed here and written
    // only if nobody changed the ingredient in between (optimistic concurrency).
    for (;;) {
      const current = await this.readIngredient(ingredient);
      const reasons = await this.transact([
        {
          ConditionCheck: {
            TableName: this.tableName,
            Key: keys.activeWorkday,
            ConditionExpression: 'workdayId = :workday',
            ExpressionAttributeValues: { ':workday': workdayId },
          },
        },
        this.put(keys.purchase(purchaseId), {}, 'attribute_not_exists(pk)'),
        this.setIngredient(ingredient, current.version, {
          stock: current.stock + quantity,
          inFlight: Math.max(0, current.demand.inFlight - quantity),
        }),
      ]);
      if (!reasons) {
        return 'applied';
      }
      if (reasons[0] === CONDITION_FAILED) {
        return 'stale';
      }
      if (reasons[1] === CONDITION_FAILED) {
        return 'duplicate';
      }
    }
  }

  async readIngredient(ingredient: Ingredient): Promise<IngredientSnapshot> {
    const { Item } = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: keys.ingredient(ingredient) }),
    );
    const item = (Item ?? {}) as IngredientItem;
    return {
      stock: item.stock ?? 0,
      demand: { waitingNeed: item.waitingNeed ?? 0, inFlight: item.inFlight ?? 0 },
      version: item.version ?? 0,
    };
  }

  async registerShortage(shortage: Shortage, expectedVersion: number): Promise<boolean> {
    const reasons = await this.transact([
      this.setIngredient(shortage.ingredient, expectedVersion, { inFlight: shortage.quantity }),
      this.put(keys.shortage(shortage.shortageId), { ...shortage }),
    ]);
    return !reasons;
  }

  async pendingShortages(ingredient: Ingredient): Promise<Shortage[]> {
    return (await this.query<Shortage>('SHORTAGE'))
      .filter((shortage) => shortage.ingredient === ingredient)
      .map(({ shortageId, workdayId, quantity }) => ({
        shortageId,
        workdayId,
        ingredient,
        quantity,
      }));
  }

  async markShortagePublished(shortageId: string): Promise<void> {
    await this.delete(keys.shortage(shortageId));
  }

  /** Deducts one ingredient only if there is enough of it; from the waiting list, its need too. */
  private deduct({ ingredient, quantity }: IngredientQuantity, options = { fromWaiting: false }) {
    return {
      Update: {
        TableName: this.tableName,
        Key: keys.ingredient(ingredient),
        UpdateExpression: options.fromWaiting
          ? 'ADD stock :minus, waitingNeed :minus, version :one'
          : 'ADD stock :minus, version :one',
        ConditionExpression: 'stock >= :quantity',
        ExpressionAttributeValues: { ':quantity': quantity, ':minus': -quantity, ':one': 1 },
      },
    };
  }

  /** Writes the fields only if the ingredient is still at the version that was read. */
  private setIngredient(
    ingredient: Ingredient,
    expectedVersion: number,
    fields: { stock?: number; inFlight?: number },
  ) {
    const entries = Object.entries(fields);
    return {
      Update: {
        TableName: this.tableName,
        Key: keys.ingredient(ingredient),
        UpdateExpression: `SET ${entries.map(([name]) => `${name} = :${name}`).join(', ')}, version = :next`,
        // An ingredient never written has no version yet, which reads as 0.
        ConditionExpression:
          expectedVersion === 0 ? 'attribute_not_exists(version)' : 'version = :expected',
        ExpressionAttributeValues: {
          ...Object.fromEntries(entries.map(([name, value]) => [`:${name}`, value])),
          ':next': expectedVersion + 1,
          ...(expectedVersion !== 0 && { ':expected': expectedVersion }),
        },
      },
    };
  }

  private put(key: { pk: string; sk: string }, attributes: object, condition?: string) {
    return {
      Put: {
        TableName: this.tableName,
        Item: { ...attributes, ...key },
        ...(condition && { ConditionExpression: condition }),
      },
    };
  }

  /**
   * Runs the transaction, retrying while DynamoDB reports a conflict with another transaction
   * on the same items (transient, not a business outcome). Returns undefined on success, or
   * why each item failed when a condition did not hold.
   */
  private async transact(items: TransactItems): Promise<Reasons | undefined> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.client.send(new TransactWriteCommand({ TransactItems: items }));
        return undefined;
      } catch (error) {
        if (!(error instanceof TransactionCanceledException)) {
          throw error;
        }
        const reasons = (error.CancellationReasons ?? []).map(({ Code }) => Code);
        if (!reasons.includes(CONFLICT) || attempt === MAX_ATTEMPTS) {
          return reasons;
        }
        await sleep(Math.random() * 20 * attempt);
      }
    }
  }

  private async query<T>(pk: string): Promise<T[]> {
    const items: T[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const page = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': pk },
          ExclusiveStartKey: start,
        }),
      );
      items.push(...((page.Items ?? []) as T[]));
      start = page.LastEvaluatedKey;
    } while (start);
    return items;
  }

  private async delete(key: { pk: string; sk: string }): Promise<void> {
    await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: key }));
  }
}
