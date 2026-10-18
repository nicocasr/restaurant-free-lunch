import type { EventType } from '@alegra-lunch/contracts';

/** The statuses of an order, in the order they happen (PLANNING §3.2). */
export const ORDER_STATUSES = [
  'PLACED',
  'COOKING_REQUESTED',
  'WAITING_INGREDIENTS',
  'PREPARING',
  'DELIVERED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

const STATUS_BY_EVENT: Partial<Record<EventType, OrderStatus>> = {
  OrderPlaced: 'PLACED',
  IngredientsRequested: 'COOKING_REQUESTED',
  OrderWaitingIngredients: 'WAITING_INGREDIENTS',
  IngredientsReserved: 'PREPARING',
  OrderDelivered: 'DELIVERED',
};

/** The status an event moves an order to, or undefined if the event does not move orders. */
export function statusFor(type: EventType): OrderStatus | undefined {
  return STATUS_BY_EVENT[type];
}

/**
 * A status only moves forward (PLANNING §3.6): a repeated or late event never takes an order
 * back. Skipping a status is fine, e.g. an order that never had to wait for ingredients.
 */
export function advance(current: OrderStatus, next: OrderStatus): OrderStatus {
  return ORDER_STATUSES.indexOf(next) > ORDER_STATUSES.indexOf(current) ? next : current;
}

/** Orders still in progress block a new workday (PLANNING §3.7). */
export function isInProgress(status: OrderStatus): boolean {
  return status !== 'DELIVERED';
}
