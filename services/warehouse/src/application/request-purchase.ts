import { randomUUID } from 'node:crypto';

import { createEvent, type Ingredient } from '@alegra-lunch/contracts';

import { evaluateDemand } from '../domain/demand';
import type { EventPublisher, WarehouseRepository } from './ports';

/**
 * Asks the market for whatever the waiting orders still need of one ingredient (§3.5).
 * The shortage is registered as pending before it is published, and every pending one is
 * published here, so a process that dies in between never loses a purchase request.
 */
export async function requestPurchaseIfNeeded(
  deps: { warehouse: WarehouseRepository; publisher: EventPublisher },
  ingredient: Ingredient,
  context: { workdayId: string; correlationId: string },
): Promise<void> {
  // Optimistic concurrency: if another evaluation wrote first, read again and re-evaluate.
  for (;;) {
    const snapshot = await deps.warehouse.readIngredient(ingredient);
    const { toPurchase } = evaluateDemand(snapshot.demand, snapshot.stock);
    if (toPurchase === 0) {
      break;
    }
    const shortage = {
      shortageId: randomUUID(),
      workdayId: context.workdayId,
      ingredient,
      quantity: toPurchase,
    };
    if (await deps.warehouse.registerShortage(shortage, snapshot.version)) {
      break;
    }
  }

  for (const shortage of await deps.warehouse.pendingShortages(ingredient)) {
    await deps.publisher.publish(
      createEvent('StockShortage', shortage, { correlationId: context.correlationId }),
    );
    await deps.warehouse.markShortagePublished(shortage.shortageId);
  }
}
