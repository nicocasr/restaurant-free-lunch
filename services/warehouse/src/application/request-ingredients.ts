import { createEvent, type EventEnvelope } from '@alegra-lunch/contracts';

import type { EventPublisher, WarehouseRepository } from './ports';
import { publishPendingReservations, publishReservation } from './publish-reservations';
import { requestPurchaseIfNeeded } from './request-purchase';

/** The order belongs to a workday the warehouse has not started yet: the message is retried. */
export class WorkdayNotStartedError extends Error {
  constructor(workdayId: string) {
    super(`Workday ${workdayId} has not started in the warehouse yet`);
    this.name = 'WorkdayNotStartedError';
  }
}

/** Handles IngredientsRequested: reserves every ingredient of the recipe at once (§3.3). */
export function requestIngredients(deps: {
  warehouse: WarehouseRepository;
  publisher: EventPublisher;
}) {
  return async (event: EventEnvelope<'IngredientsRequested'>): Promise<void> => {
    const { orderId, workdayId, ingredients } = event.payload;
    const context = { correlationId: event.correlationId };

    // WorkdayStarted may arrive after the first orders of its workday, since SQS does not
    // guarantee the order (§3.5). A plain read is enough: the workday only changes when no
    // order is in progress, and this one is.
    if ((await deps.warehouse.activeWorkday()) !== workdayId) {
      throw new WorkdayNotStartedError(workdayId);
    }

    // On a duplicate write the event is published again: the first attempt may have died
    // between the write and the publish (§3.4).
    const publishReserved = () =>
      deps.publisher.publish(createEvent('IngredientsReserved', { orderId, workdayId }, context));

    const outcome = await deps.warehouse.reserve(orderId, ingredients);
    if (outcome.status !== 'insufficient') {
      await publishReserved();
      return;
    }

    // The event time keeps the order's place in line when the message is redelivered.
    const order = { orderId, workdayId, waitingSince: event.occurredAt, needs: ingredients };
    await deps.warehouse.enqueue(order);

    // Lost wakeup: stock may have arrived after the failed reservation but before the order
    // joined the list, so nobody would retry it. 'not-waiting' means another process already
    // reserved it, so only then pending reservations are looked for.
    const retried = await deps.warehouse.reserveFromWaiting(order);
    if (retried === 'reserved') {
      await publishReservation(deps, { orderId, workdayId }, context);
      return;
    }
    if (retried === 'not-waiting') {
      await publishPendingReservations(deps, context);
      return;
    }

    await deps.publisher.publish(
      createEvent(
        'OrderWaitingIngredients',
        { orderId, workdayId, missing: outcome.missing },
        context,
      ),
    );

    // Each ingredient is independent of the others, so they are evaluated at the same time.
    await Promise.all(
      ingredients.map(({ ingredient }) =>
        requestPurchaseIfNeeded(deps, ingredient, { workdayId, ...context }),
      ),
    );
  };
}
