import type { IngredientQuantity } from '@alegra-lunch/contracts';

import type { Stock } from './stock';

export type ReservationResult =
  { reserved: true; stock: Stock } | { reserved: false; missing: IngredientQuantity[] };

/**
 * All-or-nothing reservation (PLANNING §3.5): either every ingredient of the recipe
 * is deducted, or nothing is and the exact shortfall is reported.
 */
export function reserve(stock: Stock, needs: readonly IngredientQuantity[]): ReservationResult {
  const missing = needs
    .filter(({ ingredient, quantity }) => stock[ingredient] < quantity)
    .map(({ ingredient, quantity }) => ({ ingredient, quantity: quantity - stock[ingredient] }));

  if (missing.length > 0) {
    return { reserved: false, missing };
  }

  const remaining = { ...stock };
  for (const { ingredient, quantity } of needs) {
    remaining[ingredient] -= quantity;
  }
  return { reserved: true, stock: remaining };
}
