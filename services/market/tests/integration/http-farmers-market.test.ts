import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  HttpFarmersMarket,
  InvalidMarketResponseError,
} from '../../src/infrastructure/http-farmers-market';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

/** A local stand-in for the farmers market, so tests can script any answer, even a slow one. */
async function fakeMarket(handler: Handler): Promise<{ baseUrl: string; server: Server }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${String(port)}/api/farmers-market`, server };
}

function json(body: unknown, status = 200): Handler {
  return (_request, response) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };
}

describe('HttpFarmersMarket', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
    server = undefined;
  });

  async function marketAnswering(handler: Handler, timeoutMs = 1_000) {
    const fake = await fakeMarket(handler);
    server = fake.server;
    return new HttpFarmersMarket({ baseUrl: fake.baseUrl, timeoutMs });
  }

  it('asks for the ingredient at /buy and returns the quantity sold (R5, R6)', async () => {
    let url: string | undefined;
    const market = await marketAnswering((request, response) => {
      url = request.url;
      json({ quantitySold: 4 })(request, response);
    });

    expect(await market.buy('onion')).toBe(4);
    expect(url).toBe('/api/farmers-market/buy?ingredient=onion');
  });

  it('returns 0 when the market has nothing to sell', async () => {
    const market = await marketAnswering(json({ quantitySold: 0 }));

    expect(await market.buy('potato')).toBe(0);
  });

  it.each([[{ quantitySold: -1 }], [{ quantitySold: 1.5 }], [{ quantitySold: '3' }], [{}]])(
    'rejects an answer that is not a whole quantity: %j',
    async (body) => {
      const market = await marketAnswering(json(body));

      await expect(market.buy('onion')).rejects.toThrow(InvalidMarketResponseError);
    },
  );

  it('fails when the market answers with an error status', async () => {
    const market = await marketAnswering(json({ message: 'unavailable' }, 503));

    await expect(market.buy('onion')).rejects.toThrow(/503/);
  });

  it('gives up on a market that takes too long, so the purchase is retried later', async () => {
    const market = await marketAnswering((request, response) => {
      setTimeout(() => {
        json({ quantitySold: 1 })(request, response);
      }, 500);
    }, 100);

    await expect(market.buy('onion')).rejects.toThrow(/timeout|abort/i);
  });
});
