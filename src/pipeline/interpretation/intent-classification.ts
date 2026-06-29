/**
 * Intent Classification + Top-N Intent Ranking — LLM interpretation stage.
 *
 * Uses the provider-neutral `LlmClient` to classify a PII-masked email into one customer intent
 * plus a ranked candidate list (`IntentClassificationSchema`). It only *interprets* language; it
 * makes no business decision and performs no scope validation (ADR-001).
 *
 * Fail-safe: on any LLM failure — transport error, unparseable JSON, or output that fails the
 * Zod schema (the LLM layer already retries once on invalid JSON) — this returns the
 * deterministic `unknown` classification. The existing Decision Gate routes `unknown` intent to
 * HUMAN_ESCALATION, so an LLM failure degrades safely without bypassing deterministic logic.
 */
import { Intent } from '../../domain';
import { IntentClassificationSchema } from '../../schemas';
import type { IntentClassification } from '../../types';
import { createLlmClient, type LlmClient } from '../../llm';
import { buildIntentPrompt, INTENT_PROMPT_VERSION } from './prompts';
import { containsUnmaskedPII } from '../customer-email';

export interface IntentClassificationInput {
  /** PII-masked email body (never the raw email). */
  sanitizedEmail: string;
}

export interface IntentClassificationOutcome {
  classification: IntentClassification;
  /** Identifier of the prompt template used (for Phase 7 audit). */
  promptVersion: string;
  /** True when `classification` is the deterministic safe fallback (LLM failed/invalid). */
  fallback: boolean;
}

/** The deterministic safe fallback: an `unknown` intent the Decision Gate escalates. */
function unknownFallback(): IntentClassification {
  return IntentClassificationSchema.parse({
    intent: Intent.UNKNOWN,
    confidence: 0,
    ranked: [{ intent: Intent.UNKNOWN, confidence: 0 }],
  });
}

/** Classify the email's intent. Never throws — failures collapse to the `unknown` fallback. */
export async function classifyIntent(
  input: IntentClassificationInput,
  llm?: LlmClient,
): Promise<IntentClassificationOutcome> {
  const prompt = buildIntentPrompt(input.sanitizedEmail);
  try {
    if (containsUnmaskedPII(input.sanitizedEmail)) throw new Error('Input is not PII-masked.');
    const client = llm ?? createLlmClient();
    const result = await client.generateJson(
      {
        system: prompt.system,
        user: prompt.user,
        schemaName: `IntentClassification@${INTENT_PROMPT_VERSION}`,
        temperature: 0,
      },
      IntentClassificationSchema,
    );
    return { classification: result.data, promptVersion: INTENT_PROMPT_VERSION, fallback: false };
  } catch {
    // Generic catch only: the LLM layer never includes prompt/output bodies in its errors.
    return { classification: unknownFallback(), promptVersion: INTENT_PROMPT_VERSION, fallback: true };
  }
}
