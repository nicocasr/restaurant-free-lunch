import { randomUUID } from 'node:crypto';

import { createEvent } from '@alegra-lunch/contracts';

import { broadcastEvents } from '../../src/application/broadcast-events';
import type { Connections } from '../../src/application/ports';

/** Connections that record what each one received; some can be already gone. */
class FakeConnections implements Connections {
  readonly received = new Map<string, string[]>();
  readonly removed: string[] = [];

  constructor(
    private readonly open: string[],
    private readonly gone: string[] = [],
  ) {}

  list(): Promise<string[]> {
    return Promise.resolve([...this.open, ...this.gone]);
  }

  send(connectionId: string, message: string): Promise<'sent' | 'gone'> {
    if (this.gone.includes(connectionId)) {
      return Promise.resolve('gone');
    }
    this.received.set(connectionId, [...(this.received.get(connectionId) ?? []), message]);
    return Promise.resolve('sent');
  }

  remove(connectionId: string): Promise<void> {
    this.removed.push(connectionId);
    return Promise.resolve();
  }
}

const events = [
  createEvent(
    'OrderPlaced',
    { orderId: randomUUID(), workdayId: randomUUID() },
    { correlationId: randomUUID() },
  ),
];

describe('broadcastEvents', () => {
  it('sends the batch to every open dashboard as one message', async () => {
    const connections = new FakeConnections(['tab-1', 'tab-2']);

    await broadcastEvents({ connections })(events);

    const expected = JSON.stringify({ type: 'events', events });
    expect(connections.received.get('tab-1')).toEqual([expected]);
    expect(connections.received.get('tab-2')).toEqual([expected]);
  });

  it('forgets the dashboards that closed, so they are not tried again', async () => {
    const connections = new FakeConnections(['tab-1'], ['closed-tab']);

    await broadcastEvents({ connections })(events);

    expect(connections.removed).toEqual(['closed-tab']);
    expect(connections.received.get('tab-1')).toHaveLength(1);
  });
});
