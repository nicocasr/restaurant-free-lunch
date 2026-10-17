import type { IngredientQuantity } from '@alegra-lunch/contracts';

import type {
  ReserveOutcome,
  WarehouseRepository,
  WriteOutcome,
} from '../../src/application/ports';
import { reserve } from '../../src/domain/reservation';
import type { Stock } from '../../src/domain/stock';
import { stockOf } from './stock';

/**
 * In-memory adapter for the warehouse port. Node runs it on a single thread, so every
 * method is atomic, just like the conditional writes of the DynamoDB adapter.
 */
export class InMemoryWarehouse implements WarehouseRepository {
  stock: Stock = stockOf({});
  private readonly startedWorkdays = new Set<string>();
  private readonly reservations = new Set<string>();

  startWorkday(workdayId: string, stock: Stock): Promise<WriteOutcome> {
    if (this.startedWorkdays.has(workdayId)) {
      return Promise.resolve('duplicate');
    }
    this.startedWorkdays.add(workdayId);
    this.stock = { ...stock };
    return Promise.resolve('applied');
  }

  reserve(orderId: string, needs: readonly IngredientQuantity[]): Promise<ReserveOutcome> {
    if (this.reservations.has(orderId)) {
      return Promise.resolve({ status: 'duplicate' });
    }
    const result = reserve(this.stock, needs);
    if (!result.reserved) {
      return Promise.resolve({ status: 'insufficient', missing: result.missing });
    }
    this.reservations.add(orderId);
    this.stock = result.stock;
    return Promise.resolve({ status: 'reserved' });
  }
}
