import type { Assignment, KitchenRepository } from '../../src/application/ports';

/**
 * In-memory adapter for the kitchen port. Node runs it on a single thread, so every method is
 * atomic, just like the conditional writes of the DynamoDB adapter.
 */
export class InMemoryKitchen implements KitchenRepository {
  private readonly assignments = new Map<string, Assignment>();

  assignmentOf(orderId: string): Assignment | undefined {
    return this.assignments.get(orderId);
  }

  assignOnce(assignment: Assignment): Promise<Assignment> {
    const existing = this.assignments.get(assignment.orderId);
    if (existing) {
      return Promise.resolve(existing);
    }
    this.assignments.set(assignment.orderId, assignment);
    return Promise.resolve(assignment);
  }
}
