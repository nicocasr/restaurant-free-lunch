import { createRouter } from '@alegra-lunch/shared';

import {
  AssistantUnavailableError,
  InvalidQuestionError,
  TooManyQuestionsError,
} from '../../src/application/answer-question';
import { createRoutes, statusFor } from '../../src/entrypoints/http/routes';

function api(ask: (question: string) => Promise<{ answer: string }>) {
  const router = createRouter({
    routes: createRoutes({ ask }),
    statusFor,
    logger: { error: jest.fn() },
  });
  return (body: unknown) =>
    router({
      method: 'POST',
      path: '/assistant',
      query: new URLSearchParams(),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
}

describe('assistant API', () => {
  it('answers the question at POST /assistant', async () => {
    const asked: string[] = [];
    const post = api((question) => {
      asked.push(question);
      return Promise.resolve({ answer: 'Two dishes wait for onion.' });
    });

    const response = await post({ question: 'Why are dishes waiting?' });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ answer: 'Two dishes wait for onion.' });
    expect(asked).toEqual(['Why are dishes waiting?']);
  });

  it('asks an empty question when the body has none, so the use case refuses it', async () => {
    const asked: string[] = [];
    const post = api((question) => {
      asked.push(question);
      return Promise.reject(new InvalidQuestionError());
    });

    const response = await post({ question: 42 });

    expect(asked).toEqual(['']);
    expect(response.status).toBe(400);
  });

  it.each([
    ['too many questions', new TooManyQuestionsError(), 429],
    ['the model cannot answer', new AssistantUnavailableError('quota'), 503],
  ])('answers %s with %s and the message for the manager', async (_case, error, status) => {
    const post = api(() => Promise.reject(error));

    const response = await post({ question: 'Hi?' });

    expect(response.status).toBe(status);
    expect(JSON.parse(response.body)).toEqual({ error: error.message });
  });
});
