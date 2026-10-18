/**
 * A minimal HTTP router, written instead of Express or similar frameworks (PLANNING §1). It
 * does not know about any transport: node:http (Docker) and API Gateway (Lambda) only adapt
 * their requests to this shape, so routes and errors behave the same locally and in AWS.
 */

export interface HttpRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  /** Header names in lowercase. */
  headers: Record<string, string | undefined>;
  /** The raw body, if any. */
  body: string | undefined;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface RouteRequest {
  body: unknown;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
}

export interface Route {
  method: 'GET' | 'POST';
  path: string;
  handle: (request: RouteRequest) => Promise<{ status: number; body?: unknown }>;
}

export interface RouterOptions {
  routes: readonly Route[];
  /** The status of the errors the service knows, e.g. 400 or 409; any other error is a 500. */
  statusFor?: (error: Error) => number | undefined;
  /** The origin of the dashboard, allowed to call the API from the browser. */
  corsOrigin?: string;
  logger: { error: (message: string, fields: Record<string, unknown>) => void };
}

export type Router = (request: HttpRequest) => Promise<HttpResponse>;

export function createRouter({ routes, statusFor, corsOrigin, logger }: RouterOptions): Router {
  const cors: Record<string, string> = corsOrigin
    ? {
        'access-control-allow-origin': corsOrigin,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, idempotency-key',
      }
    : {};

  const respond = (status: number, body?: unknown): HttpResponse => ({
    status,
    headers: { ...cors, ...(body !== undefined && { 'content-type': 'application/json' }) },
    body: body === undefined ? '' : JSON.stringify(body),
  });

  return async (request) => {
    if (request.method === 'OPTIONS') {
      return respond(204);
    }

    const ofPath = routes.filter(({ path }) => path === request.path);
    const route = ofPath.find(({ method }) => method === request.method);
    if (!route) {
      return ofPath.length > 0
        ? respond(405, { error: 'Method not allowed' })
        : respond(404, { error: 'Not found' });
    }

    let body: unknown;
    try {
      body = request.body ? JSON.parse(request.body) : undefined;
    } catch {
      return respond(400, { error: 'The body is not valid JSON' });
    }

    try {
      const result = await route.handle({ body, query: request.query, headers: request.headers });
      return respond(result.status, result.body);
    } catch (error) {
      const status = error instanceof Error ? statusFor?.(error) : undefined;
      if (status !== undefined) {
        return respond(status, { error: (error as Error).message });
      }
      // Unexpected errors are logged in full but never shown: they may reveal internals.
      logger.error('Unhandled error in an HTTP route', {
        error,
        method: request.method,
        path: request.path,
      });
      return respond(500, { error: 'Internal error' });
    }
  };
}
