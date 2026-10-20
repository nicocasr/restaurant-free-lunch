import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { AssistantUnavailableError } from '../../src/application/answer-question';
import { GeminiModel } from '../../src/infrastructure/gemini-model';

interface Received {
  url: string | undefined;
  apiKey: string | undefined;
  body: unknown;
}

/** A local stand-in for the Gemini API, so tests script any answer without spending quota. */
async function fakeGemini(
  status: number,
  body: unknown,
  delayMs = 0,
): Promise<{ baseUrl: string; server: Server; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let raw = '';
    request.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    request.on('end', () => {
      received.push({
        url: request.url,
        apiKey: request.headers['x-goog-api-key'] as string | undefined,
        body: JSON.parse(raw) as unknown,
      });
      setTimeout(() => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
      }, delayMs);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${String(port)}/v1beta`, server, received };
}

const PROMPT = { system: 'Answer only from the data.', user: 'Data: {}\n\nQuestion: Hi?' };

const answered = (...texts: string[]) => ({
  candidates: [{ content: { parts: texts.map((text) => ({ text })) } }],
});

describe('GeminiModel', () => {
  let server: Server | undefined;

  afterEach(async () => {
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
    server = undefined;
  });

  async function modelAnswering(status: number, body: unknown, delayMs = 0, timeoutMs = 1_000) {
    const fake = await fakeGemini(status, body, delayMs);
    server = fake.server;
    const model = new GeminiModel({
      apiKey: 'test-key',
      model: 'gemini-test',
      baseUrl: fake.baseUrl,
      timeoutMs,
    });
    return { model, received: fake.received };
  }

  it('sends the rules as the system instruction and the data with the question', async () => {
    const { model, received } = await modelAnswering(200, answered('Hello'));

    await model.answer(PROMPT);

    expect(received).toEqual([
      {
        url: '/v1beta/models/gemini-test:generateContent',
        apiKey: 'test-key',
        body: expect.objectContaining({
          systemInstruction: { parts: [{ text: PROMPT.system }] },
          contents: [{ role: 'user', parts: [{ text: PROMPT.user }] }],
        }) as unknown,
      },
    ]);
  });

  it('joins the parts of the answer', async () => {
    const { model } = await modelAnswering(200, answered('Two dishes ', 'wait for onion.'));

    await expect(model.answer(PROMPT)).resolves.toBe('Two dishes wait for onion.');
  });

  it.each([
    ['the free quota is used up', 429, {}, /free quota/],
    ['the model fails', 500, {}, /answered 500/],
    ['the model gives no answer', 200, { candidates: [] }, /no answer/],
    ['the answer is not what Gemini sends', 200, { unexpected: true }, /no answer/],
  ])('reports that the assistant is unavailable when %s', async (_case, status, body, reason) => {
    const { model } = await modelAnswering(status, body);

    const error = await model.answer(PROMPT).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AssistantUnavailableError);
    expect((error as Error).message).toMatch(reason);
  });

  it('gives up when the model takes too long', async () => {
    const { model } = await modelAnswering(200, answered('late'), 500, 100);

    await expect(model.answer(PROMPT)).rejects.toThrow(/took too long/);
  });
});
