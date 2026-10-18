import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

import WebSocket from 'ws';

import { WebSocketHub } from '../../src/infrastructure/websocket-hub';

describe('WebSocketHub', () => {
  let server: Server;
  let hub: WebSocketHub;
  let url: string;
  const clients: WebSocket[] = [];

  beforeEach(async () => {
    server = createServer();
    hub = new WebSocketHub({ server, path: '/ws' });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `ws://127.0.0.1:${String((server.address() as AddressInfo).port)}/ws`;
  });

  afterEach(async () => {
    clients.splice(0).forEach((client) => {
      client.terminate();
    });
    await hub.close();
    await new Promise((resolve) => server.close(resolve));
  });

  async function connect(): Promise<WebSocket> {
    const client = new WebSocket(url);
    clients.push(client);
    await once(client, 'open');
    // Give the server a moment to register the connection.
    await new Promise((resolve) => setTimeout(resolve, 50));
    return client;
  }

  it('registers every dashboard that connects', async () => {
    await connect();
    await connect();

    expect(await hub.list()).toHaveLength(2);
  });

  it('delivers a message to a connected dashboard', async () => {
    const client = await connect();
    const [connectionId] = await hub.list();
    const received = once(client, 'message');

    expect(await hub.send(connectionId as string, '{"type":"events","events":[]}')).toBe('sent');

    const [data] = (await received) as [Buffer];
    expect(data.toString()).toBe('{"type":"events","events":[]}');
  });

  it('forgets a dashboard that closes, and reports it as gone', async () => {
    const client = await connect();
    const [connectionId] = await hub.list();

    client.close();
    await once(client, 'close');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await hub.list()).toEqual([]);
    expect(await hub.send(connectionId as string, 'hello')).toBe('gone');
  });
});
