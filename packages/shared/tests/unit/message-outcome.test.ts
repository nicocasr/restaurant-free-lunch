import { randomUUID } from 'node:crypto';

import { createEvent, type DomainEvent } from '@alegra-lunch/contracts';

import { handleMessage } from '../../src/messaging/message-outcome';

const event = createEvent(
  'OrderPlaced',
  { orderId: randomUUID(), workdayId: randomUUID() },
  { correlationId: randomUUID() },
);
const body = JSON.stringify(event);

describe('handleMessage', () => {
  it('is done when the handler handles the event', async () => {
    const handled: DomainEvent[] = [];

    const outcome = await handleMessage(body, 1, (received) => {
      handled.push(received);
      return Promise.resolve(undefined);
    });

    expect(outcome).toEqual({ kind: 'done', event });
    expect(handled).toEqual([event]);
  });

  it('retries after the time the handler asks for (the market had nothing to sell)', async () => {
    const outcome = await handleMessage(body, 1, () => Promise.resolve({ retryAfterSeconds: 4 }));

    expect(outcome).toEqual({ kind: 'retry', seconds: 4, event });
  });

  it.each([
    [1, 1],
    [2, 2],
    [3, 4],
    [5, 10],
    [9, 10],
  ])('retries a failure on receive %i after %i s, up to 10 s', async (receives, seconds) => {
    const error = new Error('database unavailable');

    const outcome = await handleMessage(body, receives, () => Promise.reject(error));

    expect(outcome).toEqual({ kind: 'retry', seconds, event, error });
  });

  it.each([
    ['is not JSON', '{"type":'],
    ['breaks the contract', JSON.stringify({ ...event, version: 99 })],
  ])('marks a message that %s as invalid, without calling the handler', async (_, invalid) => {
    const handle = jest.fn();

    const outcome = await handleMessage(invalid, 1, handle);

    expect(outcome).toEqual({ kind: 'invalid', error: expect.any(Error) as Error });
    expect(handle).not.toHaveBeenCalled();
  });
});
