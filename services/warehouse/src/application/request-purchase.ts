import { randomUUID } from 'node:crypto';

import { createEvent, type Ingredient } from '@alegra-lunch/contracts';

import { evaluateDemand } from '../domain/demand';
import type { EventPublisher, Shortage, WarehouseRepository } from './ports';

/**
 * Asks the market for whatever the waiting orders still need of one ingredient (§3.3).
 * The shortage is registered as pending before it is published, and a pending one is
 * published here, so a process that dies in between never loses a purchase request.
 */
export async function requestPurchaseIfNeeded(
  deps: { warehouse: WarehouseRepository; publisher: EventPublisher },
  ingredient: Ingredient,
  context: { workdayId: string; correlationId: string },
): Promise<void> {
  const publish = async (shortage: Shortage) => {
    await deps.publisher.publish(
      createEvent('StockShortage', shortage, { correlationId: context.correlationId }),
    );
    await deps.warehouse.markShortagePublished(shortage.shortageId);
  };

  // Optimistic concurrency: if another evaluation wrote first, read again and re-evaluate.
  for (;;) {
    const snapshot = await deps.warehouse.readIngredient(ingredient);
    const { toPurchase } = evaluateDemand(snapshot.demand, snapshot.stock);
    if (toPurchase === 0) {
      // A shortage left unpublished by a process that died always keeps units in flight:
      // with none in flight there is nothing to look for, and one query is saved.
      if (snapshot.demand.inFlight > 0) {
        for (const pending of await deps.warehouse.pendingShortages(ingredient)) {
          await publish(pending);
        }
      }
      return;
    }
    const shortage = {
      shortageId: randomUUID(),
      workdayId: context.workdayId,
      ingredient,
      quantity: toPurchase,
    };
    if (await deps.warehouse.registerShortage(shortage, snapshot.version)) {
      // It could only be registered with nothing in flight, so no other one is pending.
      await publish(shortage);
      return;
    }
  }
}
