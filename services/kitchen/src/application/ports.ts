import type { DomainEvent } from '@alegra-lunch/contracts';

/** The recipe the kitchen drew for an order. */
export interface Assignment {
  orderId: string;
  workdayId: string;
  recipeId: string;
}

/** Persistence port of the kitchen. Every method is atomic. */
export interface KitchenRepository {
  /**
   * Stores the assignment only if the order has none yet, and returns the one that is stored:
   * a repeated message gets the recipe of the first attempt (PLANNING §3.6).
   */
  assignOnce(assignment: Assignment): Promise<Assignment>;

  findAssignment(orderId: string): Promise<Assignment | undefined>;
}

/** Publishes events to the other services. */
export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
}
