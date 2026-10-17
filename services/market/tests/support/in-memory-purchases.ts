import type {
  PurchaseRecord,
  PurchaseRepository,
  Sale,
  Shortage,
} from '../../src/application/ports';
import { startPurchase, type PurchaseProgress } from '../../src/domain/purchase-progress';

/**
 * In-memory adapter for the purchases port. Node runs it on a single thread, so every method
 * is atomic, just like the conditional writes of the DynamoDB adapter.
 */
export class InMemoryPurchases implements PurchaseRepository {
  /** Purchase history: every sale of the farmers market, in order. */
  readonly sales: Sale[] = [];
  private readonly records = new Map<string, PurchaseRecord>();

  recordOf(shortageId: string): PurchaseRecord | undefined {
    return this.records.get(shortageId);
  }

  startOrResume(shortage: Shortage): Promise<PurchaseRecord> {
    const existing = this.records.get(shortage.shortageId);
    if (existing) {
      return Promise.resolve(existing);
    }
    const { quantity, ...rest } = shortage;
    const record = { ...rest, progress: startPurchase(quantity) };
    this.records.set(shortage.shortageId, record);
    return Promise.resolve(record);
  }

  recordSale(sale: Sale, progress: PurchaseProgress): Promise<void> {
    this.sales.push(sale);
    this.saveProgress(sale.shortageId, progress);
    return Promise.resolve();
  }

  private saveProgress(shortageId: string, progress: PurchaseProgress): void {
    const record = this.records.get(shortageId);
    if (record) {
      this.records.set(shortageId, { ...record, progress });
    }
  }
}
