/**
 * Versioned prompt templates for the LLM interpretation stages (Intent Classification +
 * Top-N Ranking, and Slot Extraction).
 *
 * Each template carries a stable **prompt version identifier** so a given output can be traced
 * to the exact prompt that produced it (Phase 6 "Prompt versioning"; consumed by Phase 7 audit).
 * Bump the version whenever a template changes.
 *
 * Both builders are pure functions and operate on the **PII-masked** email only (ADR-004): the
 * caller must pass already-sanitized text. Masked placeholders (e.g. `[EMAIL_1]`, `[ORDER_ID_1]`)
 * are expected and must be preserved verbatim, never guessed or expanded.
 */
import { INTENTS } from '../../domain';

export const INTENT_PROMPT_VERSION = 'intent-classification/v2';
export const SLOT_PROMPT_VERSION = 'slot-extraction/v1';

/** The slot keys the extractor is always asked to look for (mirrors `ExtractedSlotsSchema`). */
export const REQUESTED_SLOT_KEYS = [
  'orderId',
  'customerEmail',
  'productName',
  'invoiceId',
  'reason',
] as const;

const INTENT_DEFINITIONS = [
  '- cancellation_request: the customer wants to cancel an order.',
  '- damaged_item: the customer reports a damaged, defective or broken item.',
  '- invoice_question: the customer asks about an invoice, bill, charge or payment.',
  '- product_availability: the customer asks whether a physical product or item is in stock or',
  '  available, when it will be back, or wants to buy a specific item. Classify here even if the',
  '  item might not be one we sell — whether it exists in the catalogue is decided later, not here.',
  "- unknown: the message cannot be confidently classified into one of the above.",
  '- out_of_scope: a request that is not about an order, invoice or buying a product at all — e.g. a',
  '  job or careers enquiry, a supplier / partnership / wholesale (B2B) request, or an unrelated',
  '  service we do not sell such as lessons, courses, classes or training.',
].join('\n');

const INTENT_SYSTEM = [
  'You classify a customer service email into exactly one customer intent.',
  '',
  'Allowed intents:',
  INTENT_DEFINITIONS,
  '',
  'Rules:',
  '- The email is PII-masked. Placeholders like [EMAIL_1] or [ORDER_ID_1] are normal; do not try',
  '  to reconstruct the real values, and never invent content.',
  '- The email may be written in German or English.',
  '- Choose the single best intent, and also return all candidates ranked by confidence',
  '  (highest first). Confidence is a number between 0 and 1.',
  `- "intent" and every "ranked[].intent" must be one of: ${INTENTS.join(', ')}.`,
  '',
  'Respond ONLY with a JSON object of this exact shape:',
  '{"intent": "<intent>", "confidence": <0..1>, "ranked": [{"intent": "<intent>", "confidence": <0..1>}, ...]}',
].join('\n');

const SLOT_SYSTEM = [
  'You extract structured fields from a customer service email.',
  '',
  `Fields to look for: ${REQUESTED_SLOT_KEYS.join(', ')}.`,
  '  - orderId: an order identifier.',
  '  - customerEmail: the customer e-mail address.',
  '  - productName: a product the customer refers to.',
  '  - invoiceId: an invoice identifier.',
  '  - reason: a short free-text reason the customer gives (e.g. for cancellation or damage).',
  '',
  'Rules:',
  '- The email is PII-masked. If a value appears as a placeholder (e.g. [ORDER_ID_1], [EMAIL_1]),',
  '  return that placeholder verbatim as the field value. Never guess or fabricate a value.',
  '- Only include a field in "slots" if it is actually present in the email.',
  '- List every requested field that is NOT present in "missing".',
  '- The email may be written in German or English.',
  '',
  'Respond ONLY with a JSON object of this exact shape:',
  '{"slots": {"orderId": "...", "customerEmail": "...", "productName": "...", "invoiceId": "...", "reason": "..."}, "missing": ["<field>", ...]}',
].join('\n');

/** Build the `{ system, user }` prompt for Intent Classification + Top-N Ranking. */
export function buildIntentPrompt(sanitizedEmail: string): { system: string; user: string } {
  return {
    system: INTENT_SYSTEM,
    user: `EMAIL (PII-masked):\n${sanitizedEmail || '(no text)'}`,
  };
}

/** Build the `{ system, user }` prompt for Slot Extraction. */
export function buildSlotPrompt(sanitizedEmail: string): { system: string; user: string } {
  return {
    system: SLOT_SYSTEM,
    user: `EMAIL (PII-masked):\n${sanitizedEmail || '(no text)'}`,
  };
}
