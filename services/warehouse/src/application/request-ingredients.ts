import { createEvent, type EventEnvelope } from '@alegra-lunch/contracts';

import type { EventPublisher, WarehouseRepository } from './ports';
import { requestPurchaseIfNeeded } from './request-purchase';

/** Handles IngredientsRequested: reserves every ingredient of the recipe at once (§3.5). */
export function requestIngredients(deps: {
  warehouse: WarehouseRepository;
  publisher: EventPublisher;
}) {
  return async (event: EventEnvelope<'IngredientsRequested'>): Promise<void> => {
    const { orderId, workdayId, ingredients } = event.payload;
    const context = { correlationId: event.correlationId };

    // On a duplicate write the event is published again: the first attempt may have died
    // between the write and the publish (§3.6).
    const outcome = await deps.warehouse.reserve(orderId, ingredients);
    if (outcome.status !== 'insufficient') {
      await deps.publisher.publish(
        createEvent('IngredientsReserved', { orderId, workdayId }, context),
      );
      return;
    }

    // The event time keeps the order's place in line when the message is redelivered.
    await deps.warehouse.enqueue({ orderId, waitingSince: event.occurredAt, needs: ingredients });
    await deps.publisher.publish(
      createEvent(
        'OrderWaitingIngredients',
        { orderId, workdayId, missing: outcome.missing },
        context,
      ),
    );

    for (const { ingredient } of ingredients) {
      await requestPurchaseIfNeeded(deps, ingredient, { workdayId, ...context });
    }
  };
}
