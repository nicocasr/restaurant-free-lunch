import type { Ingredient } from '@alegra-lunch/contracts';

import type { FarmersMarket } from '../../src/application/ports';

/**
 * A farmers market that answers with what a test scripts, one answer per call: a quantity, or
 * an Error to simulate a call that fails. It also measures how many calls run at once.
 */
export class ScriptedFarmersMarket implements FarmersMarket {
  readonly calls: Ingredient[] = [];
  maxCallsAtOnce = 0;
  private callsInFlight = 0;

  constructor(private readonly answers: (number | Error)[]) {}

  async buy(ingredient: Ingredient): Promise<number> {
    this.calls.push(ingredient);
    const answer = this.answers.shift();
    this.callsInFlight += 1;
    this.maxCallsAtOnce = Math.max(this.maxCallsAtOnce, this.callsInFlight);
    // Like a real HTTP call, the answer comes later: calls made together overlap.
    await new Promise((resolve) => setImmediate(resolve));
    this.callsInFlight -= 1;
    if (answer === undefined) {
      throw new Error('The farmers market script ran out of answers');
    }
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  }
}
