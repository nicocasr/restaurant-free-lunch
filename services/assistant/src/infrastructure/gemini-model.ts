import { z } from 'zod';

import { AssistantUnavailableError } from '../application/answer-question';
import type { LanguageModel } from '../application/ports';
import type { Prompt } from '../domain/build-prompt';

const ResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }).optional(),
      }),
    )
    .optional(),
});

/**
 * Gemini over its REST API (PLANNING §5), with no SDK: one POST per question. The rules go as
 * the system instruction and the data with the question as the user turn. Any failure becomes
 * an AssistantUnavailableError, so the manager gets a clear message instead of a 500.
 */
export class GeminiModel implements LanguageModel {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(deps: { apiKey: string; model: string; baseUrl: string; timeoutMs: number }) {
    this.apiKey = deps.apiKey;
    this.model = deps.model;
    this.baseUrl = deps.baseUrl;
    this.timeoutMs = deps.timeoutMs;
  }

  async answer(prompt: Prompt): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/models/${this.model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: prompt.system }] },
          contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
          // Low temperature: the answers repeat the data, they do not get creative with it.
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new AssistantUnavailableError('the model took too long');
    }

    if (response.status === 429) {
      throw new AssistantUnavailableError('the free quota of the model is used up');
    }
    if (!response.ok) {
      throw new AssistantUnavailableError(`the model answered ${String(response.status)}`);
    }

    const parsed = ResponseSchema.safeParse(await response.json().catch(() => undefined));
    const text = parsed.data?.candidates?.[0]?.content?.parts
      .map((part) => part.text ?? '')
      .join('')
      .trim();
    if (!text) {
      throw new AssistantUnavailableError('the model gave no answer');
    }
    return text;
  }
}
