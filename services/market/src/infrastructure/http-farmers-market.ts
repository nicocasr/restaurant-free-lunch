import type { Ingredient } from '@alegra-lunch/contracts';
import { z } from 'zod';

import type { FarmersMarket } from '../application/ports';

/** R6: the market answers how many units it sold; 0 means it had none. */
const BuyResponseSchema = z.object({ quantitySold: z.int().nonnegative() });

/** The market answered something that is not a whole quantity: the message is retried. */
export class InvalidMarketResponseError extends Error {
  constructor(body: unknown) {
    super(`The farmers market answered an invalid quantity: ${JSON.stringify(body)}`);
    this.name = 'InvalidMarketResponseError';
  }
}

/**
 * HTTP client of the farmers market (PLANNING §1, R5). Every failure throws, so the purchase
 * is not lost: the message goes back to the queue and is retried (§3.3).
 */
export class HttpFarmersMarket implements FarmersMarket {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(deps: { baseUrl: string; timeoutMs: number }) {
    this.baseUrl = deps.baseUrl;
    this.timeoutMs = deps.timeoutMs;
  }

  async buy(ingredient: Ingredient): Promise<number> {
    const url = `${this.baseUrl}/buy?ingredient=${encodeURIComponent(ingredient)}`;
    // A market that hangs must not hold the purchase forever.
    const response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) {
      throw new Error(`The farmers market answered ${String(response.status)} for ${ingredient}`);
    }

    const body: unknown = await response.json();
    const result = BuyResponseSchema.safeParse(body);
    if (!result.success) {
      throw new InvalidMarketResponseError(body);
    }
    return result.data.quantitySold;
  }
}
