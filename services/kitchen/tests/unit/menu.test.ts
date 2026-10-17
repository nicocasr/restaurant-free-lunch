import { MENU } from '../../src/domain/menu';

describe('menu', () => {
  it('offers the six Bogotá dishes of PLANNING §4', () => {
    expect(MENU.map(({ id, name, ingredients }) => ({ id, name, ingredients }))).toEqual([
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
    ]);
  });

  it('gives every recipe a unique id', () => {
    expect(new Set(MENU.map(({ id }) => id)).size).toBe(MENU.length);
  });

  it('never lists an ingredient twice in the same recipe', () => {
    for (const recipe of MENU) {
      const ingredients = recipe.ingredients.map(({ ingredient }) => ingredient);
      expect(new Set(ingredients).size).toBe(ingredients.length);
    }
  });
});
