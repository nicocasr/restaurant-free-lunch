import type { EventEnvelope } from '@alegra-lunch/contracts';

import { serveWaitingList } from '../domain/waiting-list';
import type { EventPublisher, WarehouseRepository } from './ports';
import { publishPendingReservations, publishReservation } from './publish-reservations';
import { requestPurchaseIfNeeded } from './request-purchase';

/** Handles IngredientPurchased: adds what the market sold to the stock (§3.3, step 3). */
export function receivePurchase(deps: {
  warehouse: WarehouseRepository;
  publisher: EventPublisher;
}) {
  return async (event: EventEnvelope<'IngredientPurchased'>): Promise<void> => {
    const { purchaseId, workdayId, ingredient, quantity } = event.payload;
    // A late purchase from a previous workday never alters the new one (§3.5). On a duplicate
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
    const reserved: { orderId: string; workdayId: string }[] = [];
    for (const order of serveWaitingList(stock, waiting).served) {
      if ((await deps.warehouse.reserveFromWaiting(order)) === 'reserved') {
        reserved.push({ orderId: order.orderId, workdayId: order.workdayId });
      }
    }

    // The orders served now are known, so they are told directly. A reservation is only left
    // pending when a process dies, and then SQS hands this purchase over again as a duplicate:
    // only that case needs to look for pending reservations in the database.
    const context = { correlationId: event.correlationId };
    if (outcome === 'duplicate') {
      await publishPendingReservations(deps, context);
    } else {
      for (const reservation of reserved) {
        await publishReservation(deps, reservation, context);
      }
    }

    // The ingredient that arrived, and every ingredient a waiting order needs: the orders just
    // served may have used up stock that a still-waiting order counted on, with no purchase of
    // it in flight. No other ingredient can need a purchase. They are independent of each
    // other, so they are evaluated at the same time.
    const toEvaluate = new Set([
      ingredient,
      ...waiting.flatMap(({ needs }) => needs.map((need) => need.ingredient)),
    ]);
    await Promise.all(
      [...toEvaluate].map((each) =>
        requestPurchaseIfNeeded(deps, each, { workdayId: event.payload.workdayId, ...context }),
      ),
    );
  };
}
