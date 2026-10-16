import { INGREDIENTS, type Ingredient } from '@alegra-lunch/contracts';

import type { Stock } from '../../src/domain/stock';

/** Builds a full stock from the given quantities; every other ingredient has 0 units. */
export function stockOf(quantities: Partial<Record<Ingredient, number>>): Stock {
  return Object.fromEntries(
    INGREDIENTS.map((ingredient) => [ingredient, quantities[ingredient] ?? 0]),
  ) as Stock;
}
