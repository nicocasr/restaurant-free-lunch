import { createEvent, type EventEnvelope } from '@alegra-lunch/contracts';

import type { EventPublisher, WarehouseRepository } from './ports';

/** Handles IngredientsRequested: reserves every ingredient of the recipe at once (§3.5). */
export function requestIngredients(deps: {
  warehouse: WarehouseRepository;
  publisher: EventPublisher;
}) {
  return async (event: EventEnvelope<'IngredientsRequested'>): Promise<void> => {
    const { orderId, workdayId, ingredients } = event.payload;
    const context = { correlationId: event.correlationId };

    const outcome = await deps.warehouse.reserve(orderId, ingredients);
    if (outcome.status === 'reserved') {
      await deps.publisher.publish(
        createEvent('IngredientsReserved', { orderId, workdayId }, context),
      );
    }
  };
}
