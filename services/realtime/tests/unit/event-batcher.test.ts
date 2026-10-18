import { randomUUID } from 'node:crypto';

import { createEvent, type DomainEvent } from '@alegra-lunch/contracts';

import { EventBatcher } from '../../src/domain/event-batcher';

const orderPlaced = () =>
  createEvent(
    'OrderPlaced',
    { orderId: randomUUID(), workdayId: randomUUID() },
    { correlationId: randomUUID() },
  );

function setup() {
  const batches: DomainEvent[][] = [];
  const onError = jest.fn();
  const batcher = new EventBatcher({
    intervalMs: 500,
    flush: (events) => {
      batches.push(events);
      return Promise.resolve();
    },
    onError,
  });
  return { batcher, batches, onError };
}

describe('EventBatcher', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends every event that arrived within the interval as a single batch (PLANNING §2)', async () => {
    const { batcher, batches } = setup();
    const events = [orderPlaced(), orderPlaced(), orderPlaced()];

    events.forEach((event) => {
      batcher.add(event);
    });
    expect(batches).toEqual([]);
    await jest.advanceTimersByTimeAsync(500);

    expect(batches).toEqual([events]);
  });

  it('sends nothing while no event arrives', async () => {
    const { batches } = setup();

    await jest.advanceTimersByTimeAsync(5_000);

    expect(batches).toEqual([]);
  });

  it('starts a new batch for the events that arrive after a batch went out', async () => {
    const { batcher, batches } = setup();
    const first = orderPlaced();
    const second = orderPlaced();

    batcher.add(first);
    await jest.advanceTimersByTimeAsync(500);
    batcher.add(second);
    await jest.advanceTimersByTimeAsync(500);

    expect(batches).toEqual([[first], [second]]);
  });

  it('drops a copy of an event already in the batch (SQS is at-least-once)', async () => {
    const { batcher, batches } = setup();
    const event = orderPlaced();

    batcher.add(event);
    batcher.add(event);
    await jest.advanceTimersByTimeAsync(500);

    expect(batches).toEqual([[event]]);
  });

  it('keeps batching after a batch fails to go out', async () => {
    const onError = jest.fn();
    let calls = 0;
    const batcher = new EventBatcher({
      intervalMs: 500,
      flush: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('socket closed')) : Promise.resolve();
      },
      onError,
    });

    batcher.add(orderPlaced());
    await jest.advanceTimersByTimeAsync(500);
    batcher.add(orderPlaced());
    await jest.advanceTimersByTimeAsync(500);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
  });
});
