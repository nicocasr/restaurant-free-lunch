import { INGREDIENTS, type Ingredient } from '@alegra-lunch/contracts';

/** Units available per ingredient. */
export type Stock = Readonly<Record<Ingredient, number>>;

/** R4: the warehouse always starts a workday with 5 units of each ingredient. */
export const INITIAL_UNITS_PER_INGREDIENT = 5;

export function initialStock(): Stock {
  return Object.fromEntries(
    INGREDIENTS.map((ingredient) => [ingredient, INITIAL_UNITS_PER_INGREDIENT]),
  ) as Stock;
}
