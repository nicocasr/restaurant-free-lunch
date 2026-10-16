import { INGREDIENTS, type Ingredient } from '@alegra-lunch/contracts';

import { reserve } from '../../src/domain/reservation';
import type { Stock } from '../../src/domain/stock';

function stockOf(quantities: Partial<Record<Ingredient, number>>): Stock {
  return Object.fromEntries(
    INGREDIENTS.map((ingredient) => [ingredient, quantities[ingredient] ?? 0]),
  ) as Stock;
}

describe('reserve', () => {
  it('deducts every ingredient of the recipe when there is enough stock', () => {
    const stock = stockOf({ chicken: 5, potato: 5, onion: 5, rice: 5, cheese: 5 });

    const result = reserve(stock, [
      { ingredient: 'chicken', quantity: 2 },
      { ingredient: 'potato', quantity: 3 },
      { ingredient: 'onion', quantity: 1 },
      { ingredient: 'rice', quantity: 1 },
    ]);

    expect(result).toEqual({
      reserved: true,
      stock: stockOf({ chicken: 3, potato: 2, onion: 4, rice: 4, cheese: 5 }),
    });
  });

  it('can use the last unit of an ingredient', () => {
    const result = reserve(stockOf({ cheese: 2, onion: 1 }), [
      { ingredient: 'cheese', quantity: 2 },
      { ingredient: 'onion', quantity: 1 },
    ]);

    expect(result).toEqual({ reserved: true, stock: stockOf({}) });
  });

  it('deducts nothing and reports the exact shortfall when one ingredient is short', () => {
    const result = reserve(stockOf({ meat: 5, potato: 1, onion: 5 }), [
      { ingredient: 'meat', quantity: 2 },
      { ingredient: 'potato', quantity: 2 },
      { ingredient: 'onion', quantity: 1 },
    ]);

    expect(result).toEqual({ reserved: false, missing: [{ ingredient: 'potato', quantity: 1 }] });
  });

  it('reports every short ingredient, in recipe order', () => {
    const result = reserve(stockOf({ meat: 1, lemon: 1 }), [
      { ingredient: 'meat', quantity: 2 },
      { ingredient: 'potato', quantity: 2 },
      { ingredient: 'onion', quantity: 1 },
      { ingredient: 'lemon', quantity: 1 },
    ]);

    expect(result).toEqual({
      reserved: false,
      missing: [
        { ingredient: 'meat', quantity: 1 },
        { ingredient: 'potato', quantity: 2 },
        { ingredient: 'onion', quantity: 1 },
      ],
    });
  });

  it('never modifies the stock it receives', () => {
    const stock = stockOf({ cheese: 5, onion: 5 });
    const snapshot = { ...stock };

    reserve(stock, [{ ingredient: 'cheese', quantity: 2 }]);

    expect(stock).toEqual(snapshot);
  });
});
