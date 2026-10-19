import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { createRouter } from '../../src/http/router';
import { createHttpHandler } from '../../src/lambda/http-lambda-handler';

const router = createRouter({
  routes: [
    {
      method: 'POST',
      path: '/echo',
      handle: ({ body, query, headers }) =>
        Promise.resolve({
          status: 201,
          body: { body, page: query.get('page'), key: headers['idempotency-key'] },
        }),
    },
  ],
  logger: { error: jest.fn() },
});

function event(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: '/echo',
    rawQueryString: 'page=2',
    headers: { 'idempotency-key': 'abc', 'content-type': 'application/json' },
    requestContext: { http: { method: 'POST' } },
    body: JSON.stringify({ quantity: 3 }),
    isBase64Encoded: false,
    ...overrides,
  } as APIGatewayProxyEventV2;
}

describe('createHttpHandler (Lambda behind API Gateway)', () => {
  const handler = createHttpHandler(router, { maxBodyBytes: 64 });

  it('serves the router with the path, query, headers and body of the request', async () => {
    const response = await handler(event());

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body ?? '')).toEqual({
      body: { quantity: 3 },
      page: '2',
      key: 'abc',
    });
    expect(response.headers?.['content-type']).toBe('application/json');
  });

  it('decodes a body API Gateway sends in base64', async () => {
    const response = await handler(
      event({
        body: Buffer.from(JSON.stringify({ quantity: 7 })).toString('base64'),
        isBase64Encoded: true,
      }),
    );

    expect(JSON.parse(response.body ?? '')).toMatchObject({ body: { quantity: 7 } });
  });

  it('refuses a body above the limit, like the container does', async () => {
    const response = await handler(event({ body: JSON.stringify({ padding: 'x'.repeat(100) }) }));

    expect(response.statusCode).toBe(413);
  });

  it('serves a request without body or query', async () => {
    const response = await handler(event({ body: undefined, rawQueryString: '' }));

    expect(JSON.parse(response.body ?? '')).toEqual({ page: null, key: 'abc' });
  });
});
