import { z } from 'zod';

import { buildPrompt } from '../domain/build-prompt';
import { summarize } from '../domain/summarize';
import type { LanguageModel, OperationsSource, QuestionLimiter } from './ports';

/** Enough for any real question; a longer text would only spend tokens. */
const MAX_QUESTION_LENGTH = 500;

const QuestionSchema = z.string().trim().min(1).max(MAX_QUESTION_LENGTH);

/** The question is empty or too long: answered with a 400. */
export class InvalidQuestionError extends Error {
  constructor() {
    super(`Ask a question of 1 to ${String(MAX_QUESTION_LENGTH)} characters`);
    this.name = 'InvalidQuestionError';
  }
}

/** The assistant reached its limit: answered with a 429, so the manager tries again later. */
export class TooManyQuestionsError extends Error {
  constructor() {
    super('The assistant got too many questions. Try again in a minute.');
    this.name = 'TooManyQuestionsError';
  }
}

/**
 * Answers a question of the manager with the data of the current workday (PLANNING §5): one
 * read of every service and one call to the model. The limit is checked first, so a refused
 * question costs nothing, and an invalid one does not even count.
 */
export function answerQuestion(deps: {
  operations: OperationsSource;
  model: LanguageModel;
  limiter: QuestionLimiter;
  clock?: () => Date;
}) {
  const clock = deps.clock ?? (() => new Date());

  return async (question: string): Promise<{ answer: string }> => {
    const parsed = QuestionSchema.safeParse(question);
    if (!parsed.success) {
      throw new InvalidQuestionError();
    }

    const now = clock();
    if (!(await deps.limiter.take(now))) {
      throw new TooManyQuestionsError();
    }

    const summary = summarize(await deps.operations.read(), now);
    const answer = await deps.model.answer(buildPrompt(summary, parsed.data));
    return { answer: answer.trim() };
  };
}
