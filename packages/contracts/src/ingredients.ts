import { z } from 'zod';

/** The ingredients the farmers market sells, as listed in the challenge statement. */
export const INGREDIENTS = [
  'tomato',
  'lemon',
  'potato',
  'rice',
  'ketchup',
  'lettuce',
  'onion',
  'cheese',
  'meat',
  'chicken',
] as const;

export const IngredientSchema = z.enum(INGREDIENTS);
export type Ingredient = z.infer<typeof IngredientSchema>;

export const IngredientQuantitySchema = z.object({
  ingredient: IngredientSchema,
  quantity: z.int().positive(),
});
export type IngredientQuantity = z.infer<typeof IngredientQuantitySchema>;
