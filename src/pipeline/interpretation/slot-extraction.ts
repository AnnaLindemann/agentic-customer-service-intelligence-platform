/**
 * Slot Extraction — LLM interpretation stage.
 *
 * Uses the provider-neutral `LlmClient` to pull structured fields (`SlotExtractionSchema`) from a
 * PII-masked email. It only *interprets* language: it does not decide which slots are *required*
 * (that is deterministic Workflow Enrichment) and makes no business decision (ADR-001).
 *
 * Masked PII (e.g. `[ORDER_ID_1]`) is returned verbatim; reconciling those tokens with real
 * records is a deterministic concern handled elsewhere via the masking log (ADR-004), not here.
 *
 * Fail-safe: on any LLM failure (transport, unparseable JSON, or schema-invalid output after the
 * single retry in the LLM layer) this returns empty slots with every requested field marked
 * missing. Downstream Data Sufficiency / Decision Gate then handle the absence deterministically
 * (request more information or escalate) — no deterministic logic is bypassed.
 */
import { SlotExtractionSchema } from '../../schemas';
import type { SlotExtraction } from '../../types';
import { createLlmClient, type LlmClient } from '../../llm';
import { buildSlotPrompt, REQUESTED_SLOT_KEYS, SLOT_PROMPT_VERSION } from './prompts';
import { containsUnmaskedPII } from '../customer-email';

export interface SlotExtractionInput {
  /** PII-masked email body (never the raw email). */
  sanitizedEmail: string;
}

export interface SlotExtractionOutcome {
  extraction: SlotExtraction;
  /** Identifier of the prompt template used (for Phase 7 audit). */
  promptVersion: string;
  /** True when `extraction` is the deterministic safe fallback (LLM failed/invalid). */
  fallback: boolean;
}

/** The deterministic safe fallback: no slots found, everything requested marked missing. */
function emptyFallback(): SlotExtraction {
  return SlotExtractionSchema.parse({ slots: {}, missing: [...REQUESTED_SLOT_KEYS] });
}

/** Extract slots from the email. Never throws — failures collapse to the empty fallback. */
export async function extractSlots(
  input: SlotExtractionInput,
  llm?: LlmClient,
): Promise<SlotExtractionOutcome> {
  const prompt = buildSlotPrompt(input.sanitizedEmail);
  try {
    if (containsUnmaskedPII(input.sanitizedEmail)) throw new Error('Input is not PII-masked.');
    const client = llm ?? createLlmClient();
    const result = await client.generateJson(
      {
        system: prompt.system,
        user: prompt.user,
        schemaName: `SlotExtraction@${SLOT_PROMPT_VERSION}`,
        temperature: 0,
      },
      SlotExtractionSchema,
    );
    return { extraction: result.data, promptVersion: SLOT_PROMPT_VERSION, fallback: false };
  } catch {
    // Generic catch only: the LLM layer never includes prompt/output bodies in its errors.
    return { extraction: emptyFallback(), promptVersion: SLOT_PROMPT_VERSION, fallback: true };
  }
}
