import { INGREDIENTS } from '@alegra-lunch/contracts';

import { INITIAL_UNITS_PER_INGREDIENT, initialStock } from '../../src/domain/stock';

describe('initialStock', () => {
  it('starts every workday with 5 units of each ingredient', () => {
    expect(INITIAL_UNITS_PER_INGREDIENT).toBe(5);
    expect(initialStock()).toEqual(
      Object.fromEntries(INGREDIENTS.map((ingredient) => [ingredient, 5])),
    );
  });

  it('returns a fresh stock each time, so one workday cannot alter the next', () => {
    expect(initialStock()).not.toBe(initialStock());
  });
});
