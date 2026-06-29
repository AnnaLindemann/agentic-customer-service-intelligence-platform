/**
 * Provider-neutral LLM contract (the "port" in a ports-and-adapters design).
 *
 * The pipeline depends only on these types — never on a vendor SDK. Each provider
 * (Groq today; OpenAI or Anthropic later) is an adapter that implements `LlmClient`.
 * Swapping providers therefore cannot reach into any pipeline stage.
 *
 * The single capability is `generateJson`: every LLM call in this system produces
 * structured JSON validated against a Zod schema, so no provider's wire format and no
 * unvalidated model text ever leaks past this boundary.
 */
import type { z } from 'zod';

/** Token usage for a single call, when the provider reports it. */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * One JSON generation request. `system`/`user` are the prompt halves. `schemaName` is used
 * only for error context — request and response bodies are never logged (they may contain
 * customer-derived text).
 */
export interface LlmJsonRequest {
  system: string;
  user: string;
  schemaName: string;
  /** Optional per-call overrides; otherwise the client's configured defaults apply. */
  temperature?: number;
  maxOutputTokens?: number;
}

/** A validated JSON result. `data` has already passed the caller's Zod schema. */
export interface LlmJsonResult<T> {
  data: T;
  /** The model that actually produced the result, as reported by the provider. */
  model: string;
  usage: LlmUsage | null;
}

/** The port every provider adapter implements. */
export interface LlmClient {
  /** The configured model id, for diagnostics. */
  readonly model: string;
  /**
   * Generate JSON and validate it against `schema`. Implementations retry once when the
   * model returns invalid JSON or output that fails the schema; on continued failure they
   * throw `LlmError`. Transport/API errors are not retried here.
   */
  generateJson<T>(req: LlmJsonRequest, schema: z.ZodType<T>): Promise<LlmJsonResult<T>>;
}

/**
 * Error raised by the LLM layer. Messages are intentionally generic (schema names and
 * status only) so that prompt bodies and model output never reach logs.
 */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: 'config' | 'transport' | 'invalid_output',
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LlmError';
  }
}
