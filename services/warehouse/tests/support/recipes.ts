import type { IngredientQuantity } from '@alegra-lunch/contracts';

/** Needs of some dishes of the menu (PLANNING §4). */
export const ajiaco: IngredientQuantity[] = [
  { ingredient: 'chicken', quantity: 2 },
  { ingredient: 'potato', quantity: 3 },
  { ingredient: 'onion', quantity: 1 },
  { ingredient: 'rice', quantity: 1 },
];

export const caldo: IngredientQuantity[] = [
  { ingredient: 'meat', quantity: 2 },
  { ingredient: 'potato', quantity: 2 },
  { ingredient: 'onion', quantity: 1 },
];

export const changua: IngredientQuantity[] = [
  { ingredient: 'cheese', quantity: 2 },
  { ingredient: 'onion', quantity: 1 },
];
