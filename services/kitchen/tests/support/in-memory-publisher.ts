import type { DomainEvent, EventType } from '@alegra-lunch/contracts';

import type { EventPublisher } from '../../src/application/ports';

/** Records every published event so tests can assert on them. */
export class InMemoryPublisher implements EventPublisher {
  readonly events: DomainEvent[] = [];
  private readonly failures = new Set<EventType>();

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
