import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';

import { nodeListener } from '../../src/http/node-listener';
import { createRouter } from '../../src/http/router';

const router = createRouter({
  routes: [
    {
      method: 'POST',
      path: '/echo',
      handle: ({ body, query }) =>
        Promise.resolve({ status: 200, body: { body, page: query.get('page') } }),
    },
  ],
  logger: { error: jest.fn() },
});

describe('nodeListener', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer(nodeListener(router, { maxBodyBytes: 64 }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('serves the router over node:http, with the path, query and body', async () => {
    const response = await fetch(`${baseUrl}/echo?page=2`, {
      method: 'POST',
      body: JSON.stringify({ quantity: 3 }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ body: { quantity: 3 }, page: '2' });
  });

  it('refuses a body above the limit, so a huge request cannot exhaust the service', async () => {
    const response = await fetch(`${baseUrl}/echo`, {
      method: 'POST',
      body: JSON.stringify({ padding: 'x'.repeat(100) }),
    });

    expect(response.status).toBe(413);
  });

  it('answers 400 instead of crashing when the body cannot be read', async () => {
    // A body stream that fails before any chunk, like a client that drops the connection
    const failing = new Readable({
      read() {
        this.destroy(new Error('connection reset'));
      },
    });
    const request = Object.assign(failing, { url: '/echo', method: 'POST', headers: {} });
    const finished = new Promise<number>((resolve) => {
      const response = {
        writeHead: (status: number) => {
          resolve(status);
          return response;
        },
        end: () => response,
      };
      nodeListener(router, { maxBodyBytes: 64 })(
        request as unknown as IncomingMessage,
        response as unknown as ServerResponse,
      );
    });

    expect(await finished).toBe(400);
  });
});
