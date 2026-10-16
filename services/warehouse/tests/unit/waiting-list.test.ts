import type { IngredientQuantity } from '@alegra-lunch/contracts';

import { serveWaitingList, type WaitingOrder } from '../../src/domain/waiting-list';
import { stockOf } from '../support/stock';

const ajiaco: IngredientQuantity[] = [
  { ingredient: 'chicken', quantity: 2 },
  { ingredient: 'potato', quantity: 3 },
  { ingredient: 'onion', quantity: 1 },
  { ingredient: 'rice', quantity: 1 },
];
const caldo: IngredientQuantity[] = [
  { ingredient: 'meat', quantity: 2 },
  { ingredient: 'potato', quantity: 2 },
  { ingredient: 'onion', quantity: 1 },
];
const changua: IngredientQuantity[] = [
  { ingredient: 'cheese', quantity: 2 },
  { ingredient: 'onion', quantity: 1 },
];

function waiting(orderId: string, minute: number, needs: IngredientQuantity[]): WaitingOrder {
  return {
    orderId,
    waitingSince: `2026-10-22T12:${String(minute).padStart(2, '0')}:00.000Z`,
    needs,
  };
}

describe('serveWaitingList', () => {
  it('skips an older order that cannot be served and serves a newer one that can', () => {
    // 2 potatoes: the Ajiaco (#1) needs 3, the Caldo (#2) needs 2
    const first = waiting('order-1', 0, ajiaco);
    const second = waiting('order-2', 1, caldo);

    const result = serveWaitingList(
      stockOf({ chicken: 5, meat: 5, potato: 2, onion: 5, rice: 5 }),
      [first, second],
    );

    expect(result.served).toEqual([second]);
    expect(result.stillWaiting).toEqual([first]);
    expect(result.stock).toEqual(stockOf({ chicken: 5, meat: 3, potato: 0, onion: 4, rice: 5 }));
  });

  it('gives the oldest order the first chance at the stock', () => {
    const older = waiting('order-old', 0, changua);
    const newer = waiting('order-new', 5, changua);

    // Received newest first: the list must still be served by arrival time
    const result = serveWaitingList(stockOf({ cheese: 2, onion: 2 }), [newer, older]);

    expect(result.served).toEqual([older]);
    expect(result.stillWaiting).toEqual([newer]);
  });

  it('serves every order, oldest first, when the stock covers them all', () => {
    const orders = [
      waiting('order-3', 2, changua),
      waiting('order-1', 0, changua),
      waiting('order-2', 1, changua),
    ];

    const result = serveWaitingList(stockOf({ cheese: 6, onion: 3 }), orders);

    expect(result.served.map(({ orderId }) => orderId)).toEqual(['order-1', 'order-2', 'order-3']);
    expect(result.stillWaiting).toEqual([]);
    expect(result.stock).toEqual(stockOf({}));
  });

  it('keeps every order waiting, oldest first, and the stock intact when none can be served', () => {
    const stock = stockOf({ onion: 5 });
    const orders = [waiting('order-2', 1, caldo), waiting('order-1', 0, ajiaco)];

    const result = serveWaitingList(stock, orders);

    expect(result.served).toEqual([]);
    expect(result.stillWaiting.map(({ orderId }) => orderId)).toEqual(['order-1', 'order-2']);
    expect(result.stock).toEqual(stock);
  });

  it('does nothing with an empty waiting list', () => {
    const stock = stockOf({ onion: 5 });
    expect(serveWaitingList(stock, [])).toEqual({ served: [], stillWaiting: [], stock });
  });
});
