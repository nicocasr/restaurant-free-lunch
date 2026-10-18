import type { DomainEvent, EventPayload, IngredientQuantity } from '@alegra-lunch/contracts';

export const ORDER_STATUSES = [
  'PLACED',
  'COOKING_REQUESTED',
  'WAITING_INGREDIENTS',
  'PREPARING',
  'DELIVERED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface OrderView {
  orderId: string;
  status: OrderStatus;
  recipeName?: string;
  missing?: IngredientQuantity[];
  waitingSince?: string;
  deliveredAt?: string;
}

export type Purchase = EventPayload<'IngredientPurchased'>;

export interface DashboardState {
  workdayId: string | undefined;
  /** Insertion order is arrival order. */
  orders: ReadonlyMap<string, OrderView>;
  purchases: readonly Purchase[];
  /** An event changed the stock: the inventory must be read again from the warehouse. */
  inventoryOutdated: boolean;
  /** Ids of the events already applied: a batch may repeat one (PLANNING §3.6). */
  seen: ReadonlySet<string>;
}

export type DashboardAction =
  | { type: 'loaded'; workdayId: string | undefined; orders: OrderView[]; purchases: Purchase[] }
  | { type: 'events'; events: readonly DomainEvent[] }
  | { type: 'inventoryReloaded' };

export const emptyDashboard: DashboardState = {
  workdayId: undefined,
  orders: new Map(),
  purchases: [],
  inventoryOutdated: false,
  seen: new Set(),
};

const rank = (status: OrderStatus) => ORDER_STATUSES.indexOf(status);

/** Applies a change to an order only if it moves forward, as the orders service does. */
function advance(
  orders: Map<string, OrderView>,
  orderId: string,
  status: OrderStatus,
  details: Partial<OrderView> = {},
): void {
  const current = orders.get(orderId) ?? { orderId, status: 'PLACED' as const };
  const moves = !orders.has(orderId) || rank(status) > rank(current.status);
  orders.set(orderId, {
    ...current,
    // The recipe never changes, so it is kept whatever the order of the events.
    ...(details.recipeName !== undefined && { recipeName: details.recipeName }),
    ...(moves && { ...details, status }),
  });
}

function applyEvent(state: DashboardState, event: DomainEvent): DashboardState {
  if (event.type === 'WorkdayStarted') {
    return {
      ...state,
      workdayId: event.payload.workdayId,
      orders: new Map(),
      purchases: [],
      inventoryOutdated: true,
    };
  }
  if (event.payload.workdayId !== state.workdayId) {
    return state;
  }

  const orders = new Map(state.orders);
  switch (event.type) {
    case 'OrderPlaced':
      advance(orders, event.payload.orderId, 'PLACED');
      return { ...state, orders };
    case 'IngredientsRequested':
      advance(orders, event.payload.orderId, 'COOKING_REQUESTED', {
        recipeName: event.payload.recipeName,
      });
      return { ...state, orders };
    case 'OrderWaitingIngredients':
      advance(orders, event.payload.orderId, 'WAITING_INGREDIENTS', {
        missing: event.payload.missing,
        waitingSince: event.occurredAt,
      });
      return { ...state, orders };
    case 'IngredientsReserved':
      advance(orders, event.payload.orderId, 'PREPARING');
      return { ...state, orders, inventoryOutdated: true };
    case 'OrderDelivered':
      advance(orders, event.payload.orderId, 'DELIVERED', { deliveredAt: event.occurredAt });
      return { ...state, orders };
    case 'IngredientPurchased':
      return {
        ...state,
        purchases: [...state.purchases, event.payload],
        inventoryOutdated: true,
      };
    default:
      return state;
  }
}

export function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case 'loaded':
      return {
        ...emptyDashboard,
        workdayId: action.workdayId,
        orders: new Map(action.orders.map((order) => [order.orderId, order])),
        purchases: action.purchases,
      };
    case 'inventoryReloaded':
      return { ...state, inventoryOutdated: false };
    case 'events': {
      let next = state;
      const seen = new Set(state.seen);
      for (const event of action.events) {
        if (!seen.has(event.id)) {
          seen.add(event.id);
          next = applyEvent(next, event);
        }
      }
      return { ...next, seen };
    }
  }
}

/** Orders still on their way, oldest first: the ones the manager is waiting for. */
export function inPreparation(state: DashboardState): OrderView[] {
  return [...state.orders.values()].filter(({ status }) => status !== 'DELIVERED');
}

/** The order history, the latest delivery first. */
export function delivered(state: DashboardState): OrderView[] {
  return [...state.orders.values()].filter(({ status }) => status === 'DELIVERED').reverse();
}
