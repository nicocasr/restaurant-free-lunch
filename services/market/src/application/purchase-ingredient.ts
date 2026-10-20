import { randomUUID } from 'node:crypto';

import { createEvent, type EventEnvelope } from '@alegra-lunch/contracts';

import type { RandomSource } from '../domain/backoff';
import { callsForNextRound, recordRound } from '../domain/purchase-progress';
import type { EventPublisher, FarmersMarket, PurchaseRepository, Sale } from './ports';

/** 'retry' asks the entrypoint to hide the message for that long (PLANNING §3.3). */
type PurchaseOutcome = { status: 'completed' } | { status: 'retry'; delaySeconds: number };

/**
 * Time a single delivery of the message may spend buying. It stays well under the 30 s
 * visibility of the queue: past it, SQS would hand the same shortage to a second buyer.
 */
const DEFAULT_BUDGET_MS = 10_000;

/**
 * Handles StockShortage: buys the ingredient at the farmers market until the shortage is
 * covered (PLANNING §3.3, step 2). Each round makes several calls at once, and every sale goes
 * to the warehouse right away. A long purchase goes on in slices: when the budget runs out the
 * message goes back to the queue and the next delivery resumes from the saved progress.
 */
export function purchaseIngredient(deps: {
  market: FarmersMarket;
  purchases: PurchaseRepository;
  publisher: EventPublisher;
  random?: RandomSource;
  clock?: () => number;
  budgetMs?: number;
}) {
  const clock = deps.clock ?? Date.now;
  const budgetMs = deps.budgetMs ?? DEFAULT_BUDGET_MS;

  return async (event: EventEnvelope<'StockShortage'>): Promise<PurchaseOutcome> => {
    const startedAt = clock();
    const publishSale = async (sale: Sale): Promise<void> => {
      await deps.publisher.publish(
        createEvent('IngredientPurchased', sale, { correlationId: event.correlationId }),
      );
      await deps.purchases.markSalePublished(sale.purchaseId);
    };

    // Resuming keeps what was already bought: the farmers market is not idempotent, so a
    // retry only buys what is still missing (§3.4). Sales recorded by an attempt that died
    // before publishing them go out first, so the warehouse never misses units.
    const record = await deps.purchases.startOrResume(event.payload);
    const { shortageId, workdayId, ingredient } = record;
    for (const sale of await deps.purchases.pendingSales(shortageId)) {
      await publishSale(sale);
    }

    let { progress } = record;
    while (callsForNextRound(progress) > 0) {
      const answers = await Promise.allSettled(
        Array.from({ length: callsForNextRound(progress) }, () => deps.market.buy(ingredient)),
      );

      // Units sold by the calls that succeeded are recorded even if another call failed. The
      // round becomes a single purchase: the warehouse gets one event, not one per call.
      const quantities = answers.flatMap((answer) =>
        answer.status === 'fulfilled' ? [answer.value] : [],
      );
      const sold = quantities.reduce((total, units) => total + units, 0);
      const sale = sold > 0 ? await recordRoundSale(sold) : undefined;
      const failed = answers.find((answer) => answer.status === 'rejected');
      if (failed) {
        throw failed.reason;
      }

      const result = recordRound(progress, quantities, deps.random);
      progress = result.progress;

      if (result.next.action === 'wait') {
        // The queue waits, not the process: SQS visibility is set in whole seconds.
        await deps.purchases.recordFailedRound(shortageId);
        return { status: 'retry', delaySeconds: Math.ceil(result.next.delayMs / 1000) };
      }

      // A round that sold nothing already waited above, so this one has its sale.
      await publishSale(sale as Sale);

      if (result.next.action === 'buy' && clock() - startedAt >= budgetMs) {
        return { status: 'retry', delaySeconds: 0 };
      }
    }
    return { status: 'completed' };

    /** Records what the round bought, before it is published. */
    async function recordRoundSale(quantity: number): Promise<Sale> {
      const sale = { purchaseId: randomUUID(), shortageId, workdayId, ingredient, quantity };
      await deps.purchases.recordSale(sale);
      return sale;
    }
  };
}
