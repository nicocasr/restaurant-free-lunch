import type { IncomingMessage, ServerResponse } from 'node:http';

import type { HttpRequest, Router } from './router';

class BodyTooLargeError extends Error {}

const json = (response: ServerResponse, status: number, error: string) => {
  response.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
  response.end(JSON.stringify({ error }));
};

/** Reads the whole body, refusing it as soon as it goes over the limit. */
async function readBody(request: IncomingMessage, maxBytes: number): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > maxBytes) {
      throw new BodyTooLargeError();
    }
    chunks.push(buffer);
  }
  return size > 0 ? Buffer.concat(chunks).toString('utf8') : undefined;
}

/** Serves a router with node:http, the local transport of the services (docs/ARCHITECTURE.md). */
export function nodeListener(router: Router, options: { maxBodyBytes: number }) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    void (async () => {
      // A server request always has a method and a URL; the types just allow undefined.
      const url = new URL(request.url as string, 'http://localhost');
      let body: string | undefined;
      try {
        body = await readBody(request, options.maxBodyBytes);
      } catch (error) {
        // Never rethrown: an unhandled rejection here would stop the whole process.
        if (error instanceof BodyTooLargeError) {
          json(response, 413, 'The body is too large');
        } else {
          json(response, 400, 'The body could not be read');
        }
        return;
      }

      const headers: HttpRequest['headers'] = {};
      for (const [name, value] of Object.entries(request.headers)) {
        headers[name] = String(value);
      }

      const result = await router({
        method: request.method as string,
        path: url.pathname,
        query: url.searchParams,
        headers,
        body,
      });
      response.writeHead(result.status, result.headers);
      response.end(result.body);
    })();
  };
}
