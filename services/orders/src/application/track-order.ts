import type { DomainEvent } from '@alegra-lunch/contracts';

import type { OrderKey, OrdersRepository, OrderUpdate } from './ports';

/** The change an event makes to its order, or undefined if the event does not move orders. */
function updateFor(event: DomainEvent): { order: OrderKey; update: OrderUpdate } | undefined {
  const key = (payload: OrderKey): OrderKey => ({
    orderId: payload.orderId,
    workdayId: payload.workdayId,
  });

  // Order events are told apart by their type: payloads may carry fields they do not declare.
  switch (event.type) {
    case 'IngredientsRequested': {
      const { recipeId, recipeName } = event.payload;
      return {
        order: key(event.payload),
        update: { status: 'COOKING_REQUESTED', recipe: { recipeId, recipeName } },
      };
    }
    case 'OrderWaitingIngredients':
      return {
        order: key(event.payload),
        update: {
          status: 'WAITING_INGREDIENTS',
          waiting: { missing: event.payload.missing, since: event.occurredAt },
        },
      };
    case 'IngredientsReserved':
      return { order: key(event.payload), update: { status: 'PREPARING' } };
    case 'OrderDelivered':
      return {
        order: key(event.payload),
        update: { status: 'DELIVERED', deliveredAt: event.occurredAt },
      };
    default:
      // OrderPlaced changes nothing: the order was saved as placed when it was created, and
      // the other events do not move an order.
      return undefined;
  }
}

/** Consumes every event of the order flow to keep the order history of the dashboard. */
export function trackOrder(deps: { orders: OrdersRepository }) {
  return async (event: DomainEvent): Promise<void> => {
    const change = updateFor(event);
    if (change) {
      await deps.orders.updateOrder(change.order, change.update);
    }
  };
}
