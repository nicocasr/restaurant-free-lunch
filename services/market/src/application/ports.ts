import type { DomainEvent, EventPayload, Ingredient } from '@alegra-lunch/contracts';

import type { PurchaseProgress } from '../domain/purchase-progress';

/** What the warehouse asked to buy (PLANNING §3.5). */
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

/** The external farmers market API. */
export interface FarmersMarket {
  /** Tries to buy the ingredient; the market decides how many units it sells (0 = none). */
  buy(ingredient: Ingredient): Promise<number>;
}

/** Persistence port of the market service. Every method is atomic. */
export interface PurchaseRepository {
  /** Creates the purchase of the shortage, or returns it if it already exists. */
  startOrResume(shortage: Shortage): Promise<PurchaseRecord>;

  /** Adds the sale to the purchase history and saves the progress, in the same write. */
  recordSale(sale: Sale, progress: PurchaseProgress): Promise<void>;

  /** Saves the progress after a call in which the market had nothing to sell. */
  saveProgress(shortageId: string, progress: PurchaseProgress): Promise<void>;
}

/** Publishes events to the other services. */
export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
}
