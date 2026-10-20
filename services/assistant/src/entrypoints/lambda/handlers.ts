import { createLambdaHttpHandler, createLogger, loadConfig } from '@alegra-lunch/shared';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { z } from 'zod';

import { statusFor } from '../http/routes';
import { assistantConfig, wire } from '../wiring';

const config = loadConfig({
  ...assistantConfig,
  CORS_ORIGIN: z.string().min(1).default('*'),
  // The name of the SecureString in SSM Parameter Store that holds the Gemini API key.
  GEMINI_API_KEY_PARAMETER: z.string().min(1),
});
const logger = createLogger({ service: 'assistant' });

async function readApiKey(): Promise<string | undefined> {
  try {
    const { Parameter } = await new SSMClient({}).send(
      new GetParameterCommand({ Name: config.GEMINI_API_KEY_PARAMETER, WithDecryption: true }),
    );
    return Parameter?.Value;
  } catch (error) {
    logger.error('Could not read the Gemini API key from SSM', { error });
    return undefined;
  }
}

/** The key is read once per Lambda instance, on its first question, never per request. */
let api: Promise<ReturnType<typeof createLambdaHttpHandler>> | undefined;

/** POST /assistant behind the shared HTTP API. */
export async function http(event: APIGatewayProxyEventV2) {
  api ??= readApiKey().then((apiKey) =>
    createLambdaHttpHandler({
      routes: wire(config, apiKey).routes,
      statusFor,
      corsOrigin: config.CORS_ORIGIN,
      logger,
    }),
  );
  return (await api)(event);
}
