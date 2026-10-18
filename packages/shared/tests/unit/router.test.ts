import { createRouter, type HttpRequest } from '../../src/http/router';

class ConflictError extends Error {}
class InvalidInputError extends Error {}

function request(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    method: 'GET',
    path: '/orders',
    query: new URLSearchParams(),
    headers: {},
    body: undefined,
    ...overrides,
  };
}

const logger = { error: jest.fn() };

const router = createRouter({
  routes: [
    { method: 'GET', path: '/orders', handle: () => Promise.resolve({ status: 200, body: [] }) },
    {
      method: 'POST',
      path: '/orders',
      handle: ({ body, headers }) =>
        Promise.resolve({ status: 202, body: { received: body, key: headers['idempotency-key'] } }),
    },
    { method: 'POST', path: '/workdays', handle: () => Promise.reject(new ConflictError('busy')) },
    {
      method: 'POST',
      path: '/invalid',
      handle: () => Promise.reject(new InvalidInputError('bad')),
    },
    { method: 'GET', path: '/boom', handle: () => Promise.reject(new Error('database password')) },
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- on purpose
    { method: 'GET', path: '/odd', handle: () => Promise.reject('not an Error') },
  ],
  statusFor: (error) =>
    error instanceof ConflictError ? 409 : error instanceof InvalidInputError ? 400 : undefined,
  corsOrigin: 'https://dashboard.example',
  logger,
});

describe('router', () => {
  it('answers with the JSON of the matching route', async () => {
    const response = await router(request());

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/json');
    expect(JSON.parse(response.body)).toEqual([]);
  });

  it('gives the handler the parsed JSON body and the headers', async () => {
    const response = await router(
      request({
        method: 'POST',
        body: JSON.stringify({ quantity: 3 }),
        headers: { 'idempotency-key': 'abc' },
      }),
    );

    expect(response.status).toBe(202);
    expect(JSON.parse(response.body)).toEqual({ received: { quantity: 3 }, key: 'abc' });
  });

  it('answers 404 for an unknown path and 405 for a known path with another method', async () => {
    expect((await router(request({ path: '/nope' }))).status).toBe(404);
    expect((await router(request({ method: 'DELETE' }))).status).toBe(405);
  });

  it('answers 400 when the body is not valid JSON', async () => {
    const response = await router(request({ method: 'POST', body: '{"quantity":' }));

    expect(response.status).toBe(400);
  });

  it('turns the errors the service knows into their status, with their message', async () => {
    const conflict = await router(request({ method: 'POST', path: '/workdays' }));
    const invalid = await router(request({ method: 'POST', path: '/invalid' }));

    expect(conflict.status).toBe(409);
    expect(JSON.parse(conflict.body)).toEqual({ error: 'busy' });
    expect(invalid.status).toBe(400);
  });

  it('answers 500 for any other error, without leaking its details, and logs it', async () => {
    const response = await router(request({ path: '/boom' }));

    expect(response.status).toBe(500);
    expect(response.body).not.toContain('password');
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ error: expect.any(Error) as Error }),
    );
  });

  it('answers 500 when a handler throws something that is not an Error', async () => {
    expect((await router(request({ path: '/odd' }))).status).toBe(500);
  });

  it('lets the dashboard call the API from its own origin (CORS)', async () => {
    const preflight = await router(request({ method: 'OPTIONS' }));
    const regular = await router(request());

    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('https://dashboard.example');
    expect(preflight.headers['access-control-allow-headers']).toMatch(/idempotency-key/i);
    expect(regular.headers['access-control-allow-origin']).toBe('https://dashboard.example');
  });
});
