import type { DomainEvent, EventType } from '@alegra-lunch/contracts';

import type { EventPublisher } from '../../src/application/ports';

/** Records every published event so tests can assert on them. */
export class InMemoryPublisher implements EventPublisher {
  readonly events: DomainEvent[] = [];

  publish(event: DomainEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  ofType<T extends EventType>(type: T): Extract<DomainEvent, { type: T }>[] {
    return this.events.filter(
      (event): event is Extract<DomainEvent, { type: T }> => event.type === type,
    );
  }
}
