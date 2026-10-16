/** Aggregated demand for one ingredient (PLANNING §3.5). */
export interface Demand {
  /** Units the orders in the waiting list need, in total. */
  waitingNeed: number;
  /** Units already requested from the market that have not arrived yet. */
  inFlight: number;
}

export interface DemandEvaluation {
  /** Units to request from the market now; 0 means no purchase is needed. */
  toPurchase: number;
  /** The demand after registering that request as in flight. */
  demand: Demand;
}

/**
 * Buys per ingredient, not per order: only the difference between what the waiting
 * orders need and what is already in stock or on its way. Leftovers therefore never
 * trigger extra purchases.
 */
export function evaluateDemand(demand: Demand, stock: number): DemandEvaluation {
  const toPurchase = Math.max(0, demand.waitingNeed - stock - demand.inFlight);
  return { toPurchase, demand: { ...demand, inFlight: demand.inFlight + toPurchase } };
}
