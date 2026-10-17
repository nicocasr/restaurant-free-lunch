import type { Ingredient } from '@alegra-lunch/contracts';

import type { FarmersMarket } from '../../src/application/ports';

/** A farmers market that answers with the quantities a test scripts, one per call. */
export class ScriptedFarmersMarket implements FarmersMarket {
  readonly calls: Ingredient[] = [];

  constructor(private readonly answers: number[]) {}

  buy(ingredient: Ingredient): Promise<number> {
    this.calls.push(ingredient);
    const quantitySold = this.answers.shift();
    if (quantitySold === undefined) {
      return Promise.reject(new Error('The farmers market script ran out of answers'));
    }
    return Promise.resolve(quantitySold);
  }
}
