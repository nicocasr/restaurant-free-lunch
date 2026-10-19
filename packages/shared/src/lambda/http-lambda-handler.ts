import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

import type { Router } from '../http/router';

/**
 * Lambda adapter of the HTTP router, behind an API Gateway HTTP API: it only translates the
 * request and the response, so routes and errors behave as in the container (PLANNING §3.4).
 */
export function createHttpHandler(router: Router, options: { maxBodyBytes: number }) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const body =
      event.body && event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;
    if (body && Buffer.byteLength(body) > options.maxBodyBytes) {
      return {
        statusCode: 413,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'The body is too large' }),
      };
    }

    const response = await router({
      method: event.requestContext.http.method,
      path: event.rawPath,
      query: new URLSearchParams(event.rawQueryString),
      // API Gateway HTTP APIs already send the header names in lowercase.
      headers: event.headers,
      body,
    });
    return { statusCode: response.status, headers: response.headers, body: response.body };
  };
}
