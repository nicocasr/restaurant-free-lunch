import { createTestTable } from '@alegra-lunch/testing';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { DynamoQuestionLimiter } from '../../src/infrastructure/dynamo-question-limiter';

const dynamo = new DynamoDBClient({});
const client = DynamoDBDocumentClient.from(dynamo);

afterAll(() => {
  dynamo.destroy();
});

describe('DynamoQuestionLimiter', () => {
  let drop: () => Promise<void>;
  let tableName: string;

  beforeEach(async () => {
    ({ tableName, drop } = await createTestTable(dynamo, 'assistant'));
  });

  afterEach(async () => {
    await drop();
  });

  const limiter = (perMinute: number, perDay: number) =>
    new DynamoQuestionLimiter({ client, tableName, perMinute, perDay });

  it('allows the questions of a minute up to its limit', async () => {
    const limit = limiter(2, 100);
    const now = new Date('2026-10-20T15:00:10.000Z');

    expect(await limit.take(now)).toBe(true);
    expect(await limit.take(now)).toBe(true);
    expect(await limit.take(now)).toBe(false);
  });

  it('starts counting again in the next minute', async () => {
    const limit = limiter(1, 100);

    expect(await limit.take(new Date('2026-10-20T15:00:59.000Z'))).toBe(true);
    expect(await limit.take(new Date('2026-10-20T15:01:00.000Z'))).toBe(true);
  });

  it('stops for the rest of the day at the daily limit', async () => {
    const limit = limiter(10, 2);

    expect(await limit.take(new Date('2026-10-20T15:00:00.000Z'))).toBe(true);
    expect(await limit.take(new Date('2026-10-20T16:00:00.000Z'))).toBe(true);
    expect(await limit.take(new Date('2026-10-20T17:00:00.000Z'))).toBe(false);
    expect(await limit.take(new Date('2026-10-21T00:00:00.000Z'))).toBe(true);
  });

  it('does not spend the daily limit on a question the minute refuses', async () => {
    const limit = limiter(1, 2);

    expect(await limit.take(new Date('2026-10-20T15:00:00.000Z'))).toBe(true);
    expect(await limit.take(new Date('2026-10-20T15:00:30.000Z'))).toBe(false);
    expect(await limit.take(new Date('2026-10-20T15:01:00.000Z'))).toBe(true);
  });

  it('lets exactly the limit through when the questions arrive at once', async () => {
    const limit = limiter(5, 100);
    const now = new Date('2026-10-20T15:00:00.000Z');

    const results = await Promise.all(Array.from({ length: 20 }, () => limit.take(now)));

    expect(results.filter(Boolean)).toHaveLength(5);
  });
});
