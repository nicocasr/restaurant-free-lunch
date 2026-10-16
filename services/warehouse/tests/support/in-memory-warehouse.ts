import type { WarehouseRepository, WriteOutcome } from '../../src/application/ports';
import type { Stock } from '../../src/domain/stock';
import { stockOf } from './stock';

/**
 * In-memory adapter for the warehouse port. Node runs it on a single thread, so every
 * method is atomic, just like the conditional writes of the DynamoDB adapter.
 */
export class InMemoryWarehouse implements WarehouseRepository {
  stock: Stock = stockOf({});
  private readonly startedWorkdays = new Set<string>();

  startWorkday(workdayId: string, stock: Stock): Promise<WriteOutcome> {
    if (this.startedWorkdays.has(workdayId)) {
      return Promise.resolve('duplicate');
    }
    this.startedWorkdays.add(workdayId);
    this.stock = { ...stock };
    return Promise.resolve('applied');
  }
}
