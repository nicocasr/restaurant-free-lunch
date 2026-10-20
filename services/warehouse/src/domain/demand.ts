/** Aggregated demand for one ingredient (PLANNING §3.3). */
export interface Demand {
  /** Units the orders in the waiting list need, in total. */
  waitingNeed: number;
  /** Units of the active purchase that have not arrived yet. */
  inFlight: number;
}

interface DemandEvaluation {
  /** Units to request from the market now; 0 means no purchase is needed. */
  toPurchase: number;
  /** The demand after registering that request as in flight. */
  demand: Demand;
}

/**
 * Buys per ingredient, not per order, with one active purchase per ingredient: while one
 * is in flight nothing else is requested, and once it completes a single request covers
 * everything that piled up. The market decides how much it sells, so separate small
 * requests would each risk leftovers. Leftovers already in stock never trigger purchases.
 */
export function evaluateDemand(demand: Demand, stock: number): DemandEvaluation {
  if (demand.inFlight > 0) {
    return { toPurchase: 0, demand };
  }
  const toPurchase = Math.max(0, demand.waitingNeed - stock);
  return { toPurchase, demand: { ...demand, inFlight: toPurchase } };
}
