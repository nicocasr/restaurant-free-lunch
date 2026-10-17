import type { IngredientQuantity } from '@alegra-lunch/contracts';

export interface Recipe {
  id: string;
  name: string;
  ingredients: [IngredientQuantity, ...IngredientQuantity[]];
}

/** The six Bogotá dishes the kitchen picks from at random (PLANNING §4). */
export const MENU: readonly Recipe[] = [
  {
    id: 'ajiaco',
    name: 'Ajiaco santafereño',
    ingredients: [
      { ingredient: 'chicken', quantity: 2 },
      { ingredient: 'potato', quantity: 3 },
      { ingredient: 'onion', quantity: 1 },
      { ingredient: 'rice', quantity: 1 },
    ],
  },
  {
    id: 'caldo-de-costilla',
    name: 'Caldo de costilla',
    ingredients: [
      { ingredient: 'meat', quantity: 2 },
      { ingredient: 'potato', quantity: 2 },
      { ingredient: 'onion', quantity: 1 },
    ],
  },
  {
    id: 'changua',
    name: 'Changua con queso',
    ingredients: [
      { ingredient: 'cheese', quantity: 2 },
      { ingredient: 'onion', quantity: 1 },
    ],
  },
  {
    id: 'picada',
    name: 'Picada bogotana',
    ingredients: [
      { ingredient: 'meat', quantity: 2 },
      { ingredient: 'potato', quantity: 2 },
      { ingredient: 'onion', quantity: 1 },
      { ingredient: 'lemon', quantity: 1 },
    ],
  },
  {
    id: 'arroz-con-pollo',
    name: 'Arroz con pollo',
    ingredients: [
      { ingredient: 'rice', quantity: 2 },
      { ingredient: 'chicken', quantity: 1 },
      { ingredient: 'tomato', quantity: 1 },
      { ingredient: 'onion', quantity: 1 },
    ],
  },
  {
    id: 'mazamorra',
    name: 'Mazamorra chiquita',
    ingredients: [
      { ingredient: 'meat', quantity: 1 },
      { ingredient: 'potato', quantity: 2 },
      { ingredient: 'onion', quantity: 1 },
    ],
  },
];
