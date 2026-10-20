import type { Route } from '@alegra-lunch/shared';

import {
  AssistantUnavailableError,
  InvalidQuestionError,
  TooManyQuestionsError,
} from '../../application/answer-question';

/** The errors the manager can meet, with the status the API answers (PLANNING §5). */
export function statusFor(error: Error): number | undefined {
  if (error instanceof InvalidQuestionError) return 400;
  if (error instanceof TooManyQuestionsError) return 429;
  if (error instanceof AssistantUnavailableError) return 503;
  return undefined;
}

/** The assistant API: one question in, one answer out. */
export function createRoutes(deps: {
  ask: (question: string) => Promise<{ answer: string }>;
}): Route[] {
  return [
    {
      method: 'POST',
      path: '/assistant',
      handle: async ({ body }) => {
        const { question } = (body ?? {}) as { question?: unknown };
        // answerQuestion validates the text; anything that is not one is an empty question.
        const answer = await deps.ask(typeof question === 'string' ? question : '');
        return { status: 200, body: answer };
      },
    },
  ];
}
