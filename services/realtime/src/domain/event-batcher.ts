import type { DomainEvent } from '@alegra-lunch/contracts';

/**
 * Groups the events that arrive within an interval into a single batch (PLANNING §2): the
 * number of messages to the dashboard depends on time, not on how many orders there are.
 * Copies of an event (SQS is at-least-once) are dropped within the batch.
 */
export class EventBatcher {
  private readonly intervalMs: number;
  private readonly flush: (events: DomainEvent[]) => Promise<void>;
  private readonly onError: (error: unknown) => void;
  private pending = new Map<string, DomainEvent>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(deps: {
    intervalMs: number;
    flush: (events: DomainEvent[]) => Promise<void>;
    onError: (error: unknown) => void;
  }) {
    this.intervalMs = deps.intervalMs;
    this.flush = deps.flush;
    this.onError = deps.onError;
  }

  add(event: DomainEvent): void {
    this.pending.set(event.id, event);
    // The first event of a batch starts the clock; the next ones just join it.
    this.timer ??= setTimeout(() => {
      void this.send();
    }, this.intervalMs);
  }

  private async send(): Promise<void> {
    const events = [...this.pending.values()];
    this.pending = new Map();
    this.timer = undefined;
    try {
      await this.flush(events);
    } catch (error) {
      this.onError(error);
    }
  }
}
