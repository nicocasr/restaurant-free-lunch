import { createEvent, type EventEnvelope } from '@alegra-lunch/contracts';

import type { EventPublisher, KitchenRepository } from './ports';

/**
 * Handles IngredientsReserved: with every ingredient in hand, the dish is prepared and handed
 * out (R7). A repeated message announces the delivery again, which is safe because the order
 * status only moves forward (PLANNING §3.6).
 */
export function deliverDish(deps: { kitchen: KitchenRepository; publisher: EventPublisher }) {
  return async (event: EventEnvelope<'IngredientsReserved'>): Promise<void> => {
    const { orderId, workdayId } = event.payload;

    const assignment = await deps.kitchen.findAssignment(orderId);
    if (!assignment) {
      // Thrown so the message is retried instead of delivering a dish without a recipe.
      throw new Error(`Order ${orderId} has no recipe assigned`);
    }

    await deps.publisher.publish(
      createEvent(
        'OrderDelivered',
        { orderId, workdayId, recipeId: assignment.recipeId },
        { correlationId: event.correlationId },
      ),
    );
  };
}
