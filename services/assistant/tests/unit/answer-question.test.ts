import {
  answerQuestion,
  InvalidQuestionError,
  TooManyQuestionsError,
} from '../../src/application/answer-question';
import type { LanguageModel, OperationsSource, QuestionLimiter } from '../../src/application/ports';
import type { Prompt } from '../../src/domain/build-prompt';
import type { Snapshot } from '../../src/domain/summarize';

const NOW = new Date('2026-10-20T15:00:00.000Z');

const SNAPSHOT: Snapshot = {
  workdayId: 'workday-1',
  orders: [
    {
      orderId: 'waiting-order',
      status: 'WAITING_INGREDIENTS',
      recipeName: 'Changua con queso',
      missing: [{ ingredient: 'onion', quantity: 1 }],
      waitingSince: '2026-10-20T14:59:30.000Z',
    },
  ],
  inventory: [{ ingredient: 'onion', stock: 0, waitingNeed: 1, inFlight: 3 }],
  purchases: [],
  recipes: [],
};

function setup({ allowed = true, reply = 'One dish waits for onion.' } = {}) {
  const prompts: Prompt[] = [];
  const takenAt: Date[] = [];
  let reads = 0;
  const operations: OperationsSource = {
    read: () => {
      reads++;
      return Promise.resolve(SNAPSHOT);
    },
  };
  const model: LanguageModel = {
    answer: (prompt) => {
      prompts.push(prompt);
      return Promise.resolve(reply);
    },
  };
  const limiter: QuestionLimiter = {
    take: (now) => {
      takenAt.push(now);
      return Promise.resolve(allowed);
    },
  };
  const ask = answerQuestion({ operations, model, limiter, clock: () => NOW });
  return { ask, prompts, takenAt, reads: () => reads };
}

describe('answerQuestion', () => {
  it('answers with the words of the model', async () => {
    const { ask } = setup({ reply: '  One dish waits for onion.\n' });

    await expect(ask('Why are orders waiting?')).resolves.toEqual({
      answer: 'One dish waits for onion.',
    });
  });

  it('asks the model with the question and the current data of the workday', async () => {
    const { ask, prompts } = setup();

    await ask('Why are orders waiting?');

    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.user).toContain('Why are orders waiting?');
    // The waiting time is measured against the clock of the use case: 30 s.
    expect(prompts[0]?.user).toContain('"waitingSeconds": 30');
    expect(prompts[0]?.user).toContain('"onItsWay": 3');
  });

  it('asks without the spaces around the question', async () => {
    const { ask, prompts } = setup();

    await ask('   What did we buy?   ');

    expect(prompts[0]?.user).toMatch(/Question: What did we buy\?$/);
  });

  it('counts the question against the limit at the current time', async () => {
    const { ask, takenAt } = setup();

    await ask('What did we buy?');

    expect(takenAt).toEqual([NOW]);
  });

  it('refuses a question over the limit without reading data or calling the model', async () => {
    const { ask, prompts, reads } = setup({ allowed: false });

    await expect(ask('What did we buy?')).rejects.toThrow(TooManyQuestionsError);
    expect(reads()).toBe(0);
    expect(prompts).toHaveLength(0);
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['longer than 500 characters', 'a'.repeat(501)],
  ])('refuses an %s question without spending the limit', async (_case, question) => {
    const { ask, takenAt, prompts } = setup();

    await expect(ask(question)).rejects.toThrow(InvalidQuestionError);
    expect(takenAt).toHaveLength(0);
    expect(prompts).toHaveLength(0);
  });

  it('lets a failure of the model reach the caller', async () => {
    const { ask } = setup();
    const failing = answerQuestion({
      operations: { read: () => Promise.resolve(SNAPSHOT) },
      model: { answer: () => Promise.reject(new Error('Gemini is down')) },
      limiter: { take: () => Promise.resolve(true) },
      clock: () => NOW,
    });

    await expect(ask('What did we buy?')).resolves.toBeDefined();
    await expect(failing('What did we buy?')).rejects.toThrow('Gemini is down');
  });
});
