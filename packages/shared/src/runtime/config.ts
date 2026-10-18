import { z } from 'zod';

/** Variables every service needs to reach its queue and publish events. */
export const messagingConfig = {
  QUEUE_URL: z.url(),
  DLQ_URL: z.url(),
  EVENTS_TOPIC_ARN: z.string().startsWith('arn:aws:sns:'),
  SHORTAGES_TOPIC_ARN: z.string().startsWith('arn:aws:sns:').endsWith('.fifo'),
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
