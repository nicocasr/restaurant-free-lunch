import type { DomainEvent } from '@alegra-lunch/contracts';

import type { Connections } from './ports';

/** Sends a batch of events to every open dashboard and forgets the ones that closed. */
export function broadcastEvents(deps: { connections: Connections }) {
  return async (events: readonly DomainEvent[]): Promise<void> => {
    // The dashboard skips events it already applied, by their id (PLANNING §3.6).
    const message = JSON.stringify({ type: 'events', events });
    const connectionIds = await deps.connections.list();
    await Promise.all(
      connectionIds.map(async (connectionId) => {
        if ((await deps.connections.send(connectionId, message)) === 'gone') {
          await deps.connections.remove(connectionId);
        }
      }),
    );
  };
}
