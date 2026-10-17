import type { EventEnvelope } from '@alegra-lunch/contracts';

import { serveWaitingList } from '../domain/waiting-list';
import type { EventPublisher, WarehouseRepository } from './ports';
import { publishPendingReservations } from './publish-reservations';

/** Handles IngredientPurchased: adds what the market sold to the stock (§3.5, step 3). */
export function receivePurchase(deps: {
  warehouse: WarehouseRepository;
  publisher: EventPublisher;
}) {
  return async (event: EventEnvelope<'IngredientPurchased'>): Promise<void> => {
    const { purchaseId, ingredient, quantity } = event.payload;
    // Even on a duplicate the rest runs again: the first attempt may have died halfway.
    await deps.warehouse.applyPurchase({ purchaseId, ingredient, quantity });

    // The domain picks the orders to serve (flexible FIFO); each one is then reserved
    // atomically, so an order another process took first is simply skipped.
    const [stock, waiting] = await Promise.all([
      deps.warehouse.readStock(),
      deps.warehouse.waitingOrders(),
    ]);
    for (const order of serveWaitingList(stock, waiting).served) {
      await deps.warehouse.reserveFromWaiting(order);
    }

    await publishPendingReservations(deps, { correlationId: event.correlationId });
  };
}
