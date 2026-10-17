import { MENU, type Recipe } from './menu';

/** A source of numbers in [0, 1), like Math.random. Injected so tests are deterministic. */
export type RandomSource = () => number;

/** R2: every dish gets one of the recipes of the menu, picked at random with equal odds. */
export function pickRecipe(random: RandomSource = Math.random): Recipe {
  const value = random();
  if (!(value >= 0 && value < 1)) {
    throw new RangeError(`Random source must return a number in [0, 1), got ${String(value)}`);
  }
  return MENU[Math.floor(value * MENU.length)] as Recipe;
}
