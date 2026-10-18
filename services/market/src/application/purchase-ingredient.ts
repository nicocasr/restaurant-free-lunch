import { randomUUID } from 'node:crypto';

import { createEvent, type EventEnvelope } from '@alegra-lunch/contracts';

import type { RandomSource } from '../domain/backoff';
import { recordSale } from '../domain/purchase-progress';
import type { EventPublisher, FarmersMarket, PurchaseRepository } from './ports';

/** 'retry' asks the entrypoint to hide the message for that long (PLANNING §3.3). */
export type PurchaseOutcome = { status: 'completed' } | { status: 'retry'; delaySeconds: number };

/**
 * Handles StockShortage: buys the ingredient at the farmers market until the shortage is
 * covered (PLANNING §3.5, step 2). Every sale goes to the warehouse right away.
 */
export function purchaseIngredient(deps: {
  market: FarmersMarket;
  purchases: PurchaseRepository;
  publisher: EventPublisher;
  random?: RandomSource;
}) {
  return async (event: EventEnvelope<'StockShortage'>): Promise<PurchaseOutcome> => {
    const record = await deps.purchases.startOrResume(event.payload);
    const { shortageId, workdayId, ingredient } = record;
    let { progress } = record;

    for (;;) {
      const quantitySold = await deps.market.buy(ingredient);
      const result = recordSale(progress, quantitySold, deps.random);
      progress = result.progress;

      if (result.next.action === 'wait') {
        // The queue waits, not the process: SQS visibility is set in whole seconds.
        await deps.purchases.saveProgress(shortageId, progress);
        return { status: 'retry', delaySeconds: Math.ceil(result.next.delayMs / 1000) };
      }

      const sale = {
        purchaseId: randomUUID(),
        shortageId,
        workdayId,
        ingredient,
        quantity: quantitySold,
      };
      await deps.purchases.recordSale(sale, progress);
      await deps.publisher.publish(
        createEvent('IngredientPurchased', sale, { correlationId: event.correlationId }),
      );

      if (result.next.action === 'complete') {
        return { status: 'completed' };
      }
    }
  };
}
