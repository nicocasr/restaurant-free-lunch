import type { DomainEvent, EventPayload, Ingredient } from '@alegra-lunch/contracts';

import type { PurchaseProgress } from '../domain/purchase-progress';

/** What the warehouse asked to buy (PLANNING §3.3). */
export type Shortage = EventPayload<'StockShortage'>;

/** One successful call to the farmers market, as kept in the purchase history. */
export type Sale = EventPayload<'IngredientPurchased'>;

/** The purchase of one shortage and how far it has gone. */
export interface PurchaseRecord {
  shortageId: string;
  workdayId: string;
  ingredient: Ingredient;
  progress: PurchaseProgress;
}

export interface FarmersMarket {
  /** Tries to buy the ingredient; the market decides how many units it sells (0 = none). */
  buy(ingredient: Ingredient): Promise<number>;
}

/** Persistence port of the market service. Every method is atomic. */
export interface PurchaseRepository {
  /** Creates the purchase of the shortage, or returns it if it already exists. */
  startOrResume(shortage: Shortage): Promise<PurchaseRecord>;

  /**
   * Adds the sale to the purchase history, pending to publish, and in the same write adds its
   * units to what was bought and resets the failed attempts. Adding, rather than overwriting
   * a total, keeps what was bought equal to the sum of the sales even with two buyers at once.
   */
  recordSale(sale: Sale): Promise<void>;

  /** Counts a round in which the market had nothing to sell. */
  recordFailedRound(shortageId: string): Promise<void>;

  /** Sales of the shortage that were recorded but not yet published. */
  pendingSales(shortageId: string): Promise<Sale[]>;

  markSalePublished(purchaseId: string): Promise<void>;

  /** Every sale of a workday: the purchase history of the dashboard. */
  listSales(workdayId: string): Promise<Sale[]>;
}

/** Publishes events to the other services. */
export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
}
