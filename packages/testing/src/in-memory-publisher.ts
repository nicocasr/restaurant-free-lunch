import type { DomainEvent, EventType } from '@alegra-lunch/contracts';

/**
 * Records every published event so tests can assert on them. It matches the EventPublisher
 * port of every service structurally, so each service keeps its own port.
 */
export class InMemoryPublisher {
  readonly events: DomainEvent[] = [];
  /** Every call to publishAll, to check what was sent together. */
  readonly batches: DomainEvent[][] = [];
  private readonly failures = new Set<EventType>();

  async publishAll(events: readonly DomainEvent[]): Promise<void> {
    this.batches.push([...events]);
    for (const event of events) {
      await this.publish(event);
    }
  }

  publish(event: DomainEvent): Promise<void> {
    if (this.failures.delete(event.type)) {
      return Promise.reject(new Error(`Simulated failure publishing ${event.type}`));
    }
    this.events.push(event);
    return Promise.resolve();
  }

  /** Makes the next publish of that event type fail, as if the process died right there. */
  failNext(type: EventType): void {
    this.failures.add(type);
  }

  ofType<T extends EventType>(type: T): Extract<DomainEvent, { type: T }>[] {
    return this.events.filter(
      (event): event is Extract<DomainEvent, { type: T }> => event.type === type,
    );
  }
}
