/**
 * OpenAI-compatible provider adapter.
 *
 * Groq exposes an OpenAI-compatible Chat Completions API, so a single adapter built on the
 * official `openai` SDK serves both Groq (today) and OpenAI (later) — only the base URL, key
 * and model differ. Anthropic, whose Messages API differs, would be a separate adapter file
 * implementing the same `LlmClient` port; nothing in the pipeline would change.
 *
 * Responsibilities kept inside this boundary:
 *   - JSON mode (`response_format: json_object`) plus Zod validation of the parsed output;
 *   - exactly one retry when the model returns invalid JSON or schema-invalid output;
 *   - no logging of prompt or completion bodies (they may contain customer-derived text).
 */
import OpenAI from 'openai';
import type { z } from 'zod';
import { LlmError, type LlmClient, type LlmJsonRequest, type LlmJsonResult } from '../types';

export interface OpenAiCompatibleConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  /** Provider label for error messages only. */
  providerLabel: string;
  /** Internal deterministic test seam; production always uses the SDK client below. */
  completionCreate?: CompletionCreate;
}

interface CompletionResponse {
  choices: Array<{ message?: { content?: string | null } }>;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

interface CompletionRequest {
  model: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  response_format: { type: 'json_object' };
  temperature: number;
  max_completion_tokens: number;
}

export type CompletionCreate = (request: CompletionRequest) => Promise<CompletionResponse>;

/** Parse a JSON string without throwing; distinguishes "bad JSON" from a thrown SDK error. */
function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

export function createOpenAiCompatibleClient(cfg: OpenAiCompatibleConfig): LlmClient {
  if (!cfg.apiKey) {
    throw new LlmError(
      `Missing API key for provider "${cfg.providerLabel}". Set the API key environment variable.`,
      'config',
    );
  }

  // maxRetries: 0 — we own the (single, JSON-only) retry policy; the SDK should not add its own.
  let completionCreate = cfg.completionCreate;
  if (!completionCreate) {
    const client = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseUrl,
      timeout: cfg.timeoutMs,
      maxRetries: 0,
    });
    completionCreate = async (request) => client.chat.completions.create(request);
  }

  return {
    model: cfg.model,

    async generateJson<T>(
      req: LlmJsonRequest,
      schema: z.ZodType<T>,
    ): Promise<LlmJsonResult<T>> {
      const messages = [
        { role: 'system' as const, content: req.system },
        { role: 'user' as const, content: req.user },
      ];

      // Two attempts total: the initial call plus one retry, but only when the failure is an
      // invalid/schema-invalid JSON body. Transport errors propagate immediately.
      const maxAttempts = 2;
      let lastReason = 'unknown';

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let completion;
        try {
          completion = await completionCreate({
            model: cfg.model,
            messages,
            response_format: { type: 'json_object' },
            temperature: req.temperature ?? cfg.temperature,
            max_completion_tokens: req.maxOutputTokens ?? cfg.maxOutputTokens,
          });
        } catch (cause) {
          // Network/API failure — not a JSON problem, so do not consume the retry on it.
          throw new LlmError(
            `${cfg.providerLabel} request failed for ${req.schemaName}.`,
            'transport',
            { cause },
          );
        }

        const content = completion.choices[0]?.message?.content ?? '';
        const parsed = tryParseJson(content);
        if (parsed.ok) {
          const validated = schema.safeParse(parsed.value);
          if (validated.success) {
            const usage = completion.usage
              ? {
                  inputTokens: completion.usage.prompt_tokens ?? 0,
                  outputTokens: completion.usage.completion_tokens ?? 0,
                }
              : null;
            return { data: validated.data, model: completion.model ?? cfg.model, usage };
          }
          lastReason = 'schema-invalid';
        } else {
          lastReason = 'unparseable-json';
        }
        // fall through to retry (if any attempts remain)
      }

      // Generic message only: never include the model output (possible customer-derived text).
      throw new LlmError(
        `${cfg.providerLabel} returned ${lastReason} output for ${req.schemaName} after ${maxAttempts} attempts.`,
        'invalid_output',
      );
    },
  };
}
