import { createEvent } from '@alegra-lunch/contracts';

import type { EventPublisher, PendingReservation, WarehouseRepository } from './ports';

/** Tells the kitchen it can prepare an order reserved from the waiting list, and forgets it. */
export async function publishReservation(
  deps: { warehouse: WarehouseRepository; publisher: EventPublisher },
  reservation: PendingReservation,
  context: { correlationId: string },
): Promise<void> {
  await deps.publisher.publish(createEvent('IngredientsReserved', reservation, context));
  await deps.warehouse.markReservationPublished(reservation.orderId);
}

/**
 * Tells the kitchen about every reservation made from the waiting list that is still pending.
 * An order that left the waiting list can only be recovered this way if the process that
 * reserved it died before publishing (§3.5).
 */
export async function publishPendingReservations(
  deps: { warehouse: WarehouseRepository; publisher: EventPublisher },
  context: { correlationId: string },
): Promise<void> {
  for (const reservation of await deps.warehouse.pendingReservations()) {
    await publishReservation(deps, reservation, context);
  }
}
