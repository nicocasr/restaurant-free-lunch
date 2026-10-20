import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';

import { answerQuestion, AssistantUnavailableError } from '../application/answer-question';
import type { LanguageModel } from '../application/ports';
import { DynamoQuestionLimiter } from '../infrastructure/dynamo-question-limiter';
import { GeminiModel } from '../infrastructure/gemini-model';
import { HttpOperations } from '../infrastructure/http-operations';
import { createRoutes } from './http/routes';

/** Variables of the assistant in both runtimes (PLANNING §5). */
export const assistantConfig = {
  TABLE_NAME: z.string().min(1),
  // The query APIs the assistant reads: one per service locally, the same HTTP API in AWS.
  ORDERS_URL: z.url(),
  WAREHOUSE_URL: z.url(),
  MARKET_URL: z.url(),
  KITCHEN_URL: z.url(),
  // A fixed model, not a "-latest" alias, so the answers do not change behind our back.
  GEMINI_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
  GEMINI_BASE_URL: z.url().default('https://generativelanguage.googleapis.com/v1beta'),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  // Kept below the free quota of Gemini, which Google does not publish as fixed numbers.
  QUESTIONS_PER_MINUTE: z.coerce.number().int().positive().default(10),
  QUESTIONS_PER_DAY: z.coerce.number().int().positive().default(200),
};

type AssistantConfig = z.infer<z.ZodObject<typeof assistantConfig>>;

/**
 * The real adapters connected to the use case, shared by the container and Lambda. Without an
 * API key the service still starts: every question gets a clear "not configured" answer, so a
 * reviewer without a key can use everything else.
 */
export function wire(config: AssistantConfig, apiKey: string | undefined) {
  const model: LanguageModel = apiKey
    ? new GeminiModel({
        apiKey,
        model: config.GEMINI_MODEL,
        baseUrl: config.GEMINI_BASE_URL,
        timeoutMs: config.GEMINI_TIMEOUT_MS,
      })
    : {
        answer: () =>
          Promise.reject(new AssistantUnavailableError('no Gemini API key is configured')),
      };

  const ask = answerQuestion({
    model,
    operations: new HttpOperations({
      urls: {
        orders: config.ORDERS_URL,
        warehouse: config.WAREHOUSE_URL,
        market: config.MARKET_URL,
        kitchen: config.KITCHEN_URL,
      },
      timeoutMs: 5_000,
    }),
    limiter: new DynamoQuestionLimiter({
      client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
      tableName: config.TABLE_NAME,
      perMinute: config.QUESTIONS_PER_MINUTE,
      perDay: config.QUESTIONS_PER_DAY,
    }),
  });

  return { routes: createRoutes({ ask }) };
}
