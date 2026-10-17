import { INGREDIENTS, type EventEnvelope } from '@alegra-lunch/contracts';

import { serveWaitingList } from '../domain/waiting-list';
import type { EventPublisher, WarehouseRepository } from './ports';
import { publishPendingReservations } from './publish-reservations';
import { requestPurchaseIfNeeded } from './request-purchase';

/** Handles IngredientPurchased: adds what the market sold to the stock (§3.5, step 3). */
export function receivePurchase(deps: {
  warehouse: WarehouseRepository;
  publisher: EventPublisher;
}) {
  return async (event: EventEnvelope<'IngredientPurchased'>): Promise<void> => {
    const { purchaseId, workdayId, ingredient, quantity } = event.payload;
    // A late purchase from a previous workday never alters the new one (§3.7). On a duplicate
    // the rest runs again: the first attempt may have died halfway.
    const outcome = await deps.warehouse.applyPurchase({
      purchaseId,
      workdayId,
      ingredient,
      quantity,
    });
    if (outcome === 'stale') {
      return;
    }

    // The domain picks the orders to serve (flexible FIFO); each one is then reserved
    // atomically, so an order another process took first is simply skipped.
    const [stock, waiting] = await Promise.all([
      deps.warehouse.readStock(),
      deps.warehouse.waitingOrders(),
    ]);
    for (const order of serveWaitingList(stock, waiting).served) {
      await deps.warehouse.reserveFromWaiting(order);
    }

    const context = { correlationId: event.correlationId };
    await publishPendingReservations(deps, context);

    // Every ingredient, not only the one that arrived: the orders just served may have used
    // up stock that a still-waiting order counted on, with no purchase of it in flight.
    for (const each of INGREDIENTS) {
      await requestPurchaseIfNeeded(deps, each, { workdayId: event.payload.workdayId, ...context });
    }
  };
}
