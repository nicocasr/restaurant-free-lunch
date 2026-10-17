import type { IngredientQuantity } from '@alegra-lunch/contracts';

import { reserve } from './reservation';
import type { Stock } from './stock';

export interface WaitingOrder {
  orderId: string;
  workdayId: string;
  /** ISO timestamp of when the order joined the waiting list. */
  waitingSince: string;
  needs: IngredientQuantity[];
}

export interface WaitingListOutcome {
  /** Orders whose ingredients were reserved, in the order they were served. */
  served: WaitingOrder[];
  /** Orders that still lack ingredients, oldest first. */
  stillWaiting: WaitingOrder[];
  stock: Stock;
}

/**
 * Flexible FIFO (PLANNING §3.5): orders are tried oldest first, but one that cannot be
 * served does not block the ones behind it.
 */
export function serveWaitingList(
  stock: Stock,
  waiting: readonly WaitingOrder[],
): WaitingListOutcome {
  const byArrival = [...waiting].sort((a, b) => a.waitingSince.localeCompare(b.waitingSince));
  const outcome: WaitingListOutcome = { served: [], stillWaiting: [], stock };

  for (const order of byArrival) {
    const result = reserve(outcome.stock, order.needs);
    if (result.reserved) {
      outcome.served.push(order);
      outcome.stock = result.stock;
    } else {
      outcome.stillWaiting.push(order);
    }
  }
  return outcome;
}
