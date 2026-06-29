/**
 * Interpretation barrel — the LLM language-understanding stages (Phase 6).
 *
 * These stages turn a PII-masked email into validated structured meaning (intent + ranked
 * candidates, and extracted slots). They interpret only; deterministic modules decide
 * (ADR-001). The pipeline depends on these entry points:
 *
 *   import { classifyIntent, extractSlots } from './pipeline/interpretation';
 */
export {
  classifyIntent,
  type IntentClassificationInput,
  type IntentClassificationOutcome,
} from './intent-classification';

export {
  extractSlots,
  type SlotExtractionInput,
  type SlotExtractionOutcome,
} from './slot-extraction';

export {
  buildIntentPrompt,
  buildSlotPrompt,
  INTENT_PROMPT_VERSION,
  SLOT_PROMPT_VERSION,
  REQUESTED_SLOT_KEYS,
} from './prompts';
