/**
 * Provider-independent pricing abstraction (Phase 7).
 *
 * Cost is derived from token usage and a small, in-code price book keyed by model id. Pricing
 * lives here — not inside any pipeline stage — so adding a provider or adjusting a rate is a
 * single-table change with no effect on processing behaviour.
 *
 * Rates are USD per 1,000,000 tokens. Models absent from the table are not an error: the cost
 * estimate is simply `null`, which the audit layer carries through unchanged.
 */

/** Published price for one model, in USD per million tokens (input and output billed separately). */
export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

/**
 * In-code price book. Values are prototype estimates and should be confirmed against the
 * provider's current published pricing before any cost figure is treated as authoritative.
 *
 * Keyed by the exact model id the provider reports (e.g. Groq's `openai/gpt-oss-120b`). To add
 * an OpenAI or Anthropic model later, add its id and rate here — nothing else changes.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = Object.freeze({
  // Groq — GPT-OSS family (the prototype's default models).
  'openai/gpt-oss-120b': { inputPerMillion: 0.15, outputPerMillion: 0.75 },
  'openai/gpt-oss-20b': { inputPerMillion: 0.1, outputPerMillion: 0.5 },
});

const TOKENS_PER_MILLION = 1_000_000;

/** Return the price entry for a model id, or null when the model is not in the price book. */
export function getModelPrice(model: string | null | undefined): ModelPrice | null {
  if (!model) return null;
  return MODEL_PRICES[model] ?? null;
}

/**
 * Estimate the USD cost of a single call.
 *
 * Returns `null` (never throws) when the model is unknown or token counts are unavailable, so a
 * missing price can never block a response or corrupt the audit record.
 */
export function estimateCostUsd(
  model: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): number | null {
  const price = getModelPrice(model);
  if (price === null) return null;
  if (inputTokens == null || outputTokens == null) return null;

  const cost =
    (inputTokens / TOKENS_PER_MILLION) * price.inputPerMillion +
    (outputTokens / TOKENS_PER_MILLION) * price.outputPerMillion;

  // Round to 6 dp: sub-cent per-call costs must survive without underflowing to 0.
  return Math.round(cost * 1_000_000) / 1_000_000;
}
