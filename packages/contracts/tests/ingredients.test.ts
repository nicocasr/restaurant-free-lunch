import { INGREDIENTS, IngredientSchema } from '../src';

describe('ingredients', () => {
  it('lists exactly the ten ingredients from the challenge statement', () => {
    expect([...INGREDIENTS].sort()).toEqual(
      [
        'cheese',
        'chicken',
        'ketchup',
        'lemon',
        'lettuce',
        'meat',
        'onion',
        'potato',
        'rice',
        'tomato',
      ].sort(),
    );
  });

  it('accepts a known ingredient', () => {
    expect(IngredientSchema.parse('onion')).toBe('onion');
  });

  it('rejects an unknown ingredient', () => {
    expect(IngredientSchema.safeParse('garlic').success).toBe(false);
  });
});
