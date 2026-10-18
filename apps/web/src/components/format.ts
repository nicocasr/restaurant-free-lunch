import type { OrderStatus } from '../state/dashboard';

export const STATUS_LABELS: Record<OrderStatus, string> = {
  PLACED: 'Placed',
  COOKING_REQUESTED: 'Picking ingredients',
  WAITING_INGREDIENTS: 'Waiting for ingredients',
  PREPARING: 'Preparing',
  DELIVERED: 'Delivered',
};

/** "12 s" or "3 min 5 s": how long something has been going on. */
export function elapsed(since: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(since)) / 1000));
  if (seconds < 60) return `${String(seconds)} s`;
  return `${String(Math.floor(seconds / 60))} min ${String(seconds % 60)} s`;
}

export const shortId = (id: string) => id.slice(0, 8);
