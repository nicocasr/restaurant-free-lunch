import type { DomainEvent } from '@alegra-lunch/contracts';

import { statusFor } from '../domain/order-status';
import type { OrderKey, OrdersRepository, OrderUpdate } from './ports';

/** The change an event makes to its order, or undefined if the event does not move orders. */
function updateFor(event: DomainEvent): { order: OrderKey; update: OrderUpdate } | undefined {
  const status = statusFor(event.type);
  if (!status || !('orderId' in event.payload)) {
    return undefined;
  }
  const { orderId, workdayId } = event.payload;
  const order = { orderId, workdayId };

  switch (event.type) {
    case 'IngredientsRequested': {
      const { recipeId, recipeName } = event.payload;
      return { order, update: { status, recipe: { recipeId, recipeName } } };
    }
    case 'OrderWaitingIngredients':
      return {
        order,
        update: { status, waiting: { missing: event.payload.missing, since: event.occurredAt } },
      };
    default:
      return { order, update: { status } };
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
