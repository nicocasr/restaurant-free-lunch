import type { Prompt } from '../domain/build-prompt';
import type { Snapshot } from '../domain/summarize';

/** Reads the workday from the query APIs of the services that own the data (PLANNING §3.1). */
export interface OperationsSource {
  read(): Promise<Snapshot>;
}

/** The language model that turns the data and the question into an answer (Gemini). */
export interface LanguageModel {
  answer(prompt: Prompt): Promise<string>;
}

/**
 * Counts the questions so the free quota of the model is never exhausted (PLANNING §5).
 * Returns false when the question would go over the limit; it is atomic across instances.
 */
export interface QuestionLimiter {
  take(now: Date): Promise<boolean>;
}
