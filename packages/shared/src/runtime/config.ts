import { z } from 'zod';

/** Variables every service needs to reach its queue and publish events. */
export const messagingConfig = {
  QUEUE_URL: z.url(),
  DLQ_URL: z.url(),
  EVENTS_TOPIC_ARN: z.string().startsWith('arn:aws:sns:'),
  SHORTAGES_TOPIC_ARN: z.string().startsWith('arn:aws:sns:').endsWith('.fifo'),
};

/** Variables of a service running in Lambda: its triggers come from the event source mapping. */
export const lambdaConfig = {
  DLQ_URL: z.url(),
  EVENTS_TOPIC_ARN: messagingConfig.EVENTS_TOPIC_ARN,
  SHORTAGES_TOPIC_ARN: messagingConfig.SHORTAGES_TOPIC_ARN,
  CORS_ORIGIN: z.string().min(1).default('*'),
};

/** Variables of the HTTP API every service serves (PLANNING §2). */
export const httpConfig = {
  PORT: z.coerce.number().int().positive(),
  // The dashboard origin; '*' is fine locally, AWS sets the CloudFront domain.
  CORS_ORIGIN: z.string().min(1).default('*'),
};

/** A variable is missing or invalid: the service refuses to start (PLANNING §3.8). */
export class ConfigError extends Error {
  constructor(error: z.ZodError) {
    super(`Invalid configuration:\n${z.prettifyError(error)}`);
    this.name = 'ConfigError';
  }
}

/** Reads and validates the environment once, at startup, so a typo fails fast and clearly. */
export function loadConfig<T extends z.ZodRawShape>(
  shape: T,
  env: NodeJS.ProcessEnv = process.env,
): z.infer<z.ZodObject<T>> {
  const result = z.object(shape).safeParse(env);
  if (!result.success) {
    throw new ConfigError(result.error);
  }
  return result.data;
}
