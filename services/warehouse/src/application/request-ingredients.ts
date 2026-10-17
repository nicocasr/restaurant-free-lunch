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
    const publishReserved = () =>
      deps.publisher.publish(createEvent('IngredientsReserved', { orderId, workdayId }, context));

    const outcome = await deps.warehouse.reserve(orderId, ingredients);
    if (outcome.status !== 'insufficient') {
      await publishReserved();
      return;
    }

    // The event time keeps the order's place in line when the message is redelivered.
    const order = { orderId, waitingSince: event.occurredAt, needs: ingredients };
    await deps.warehouse.enqueue(order);

    // Lost wakeup: stock may have arrived after the failed reservation but before the order
    // joined the list, so nobody would retry it. 'not-waiting' means another process already
    // reserved it; publishing again is safe and covers that process dying before publishing.
    if ((await deps.warehouse.reserveFromWaiting(order)) !== 'insufficient') {
      await publishReserved();
      return;
    }

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
