import { MENU } from '../../src/domain/menu';
import { pickRecipe } from '../../src/domain/pick-recipe';

/** Deterministic pseudo-random generator (mulberry32), so the distribution test never flakes. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('pickRecipe', () => {
  it('picks the first recipe at the lowest random value', () => {
    expect(pickRecipe(() => 0)).toBe(MENU[0]);
  });

  it('picks the last recipe at the highest random value', () => {
    expect(pickRecipe(() => 0.999999)).toBe(MENU[MENU.length - 1]);
  });

  it('can pick every recipe of the menu', () => {
    MENU.forEach((recipe, index) => {
      expect(pickRecipe(() => (index + 0.5) / MENU.length)).toBe(recipe);
    });
  });

  it('picks the recipes evenly', () => {
    const random = seeded(42);
    const draws = 60_000;
    const counts = new Map<string, number>();

    for (let i = 0; i < draws; i++) {
      const { id } = pickRecipe(random);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    const expected = draws / MENU.length;
    for (const recipe of MENU) {
      expect(Math.abs((counts.get(recipe.id) ?? 0) - expected)).toBeLessThan(expected * 0.05);
    }
  });

  it('uses Math.random when no random source is given', () => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);

    expect(pickRecipe()).toBe(MENU[0]);
    expect(random).toHaveBeenCalledTimes(1);

    random.mockRestore();
  });

  it.each([-0.1, 1, Number.NaN])('rejects a random source that returns %p', (value) => {
    expect(() => pickRecipe(() => value)).toThrow(RangeError);
  });
});
