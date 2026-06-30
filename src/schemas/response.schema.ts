import { z } from 'zod';
import { REASON_CODES } from '../domain';
import { DecisionSchema } from './decision.schema';

/**
 * Raw JSON contract the Response Generator LLM must return. This is LLM output and is
 * always validated against this schema (with one retry on failure) before any value is
 * trusted. Anything beyond these two fields is ignored.
 *
 *   - `reply`     — the German customer-facing message.
 *   - `citedRefs` — the evidence references the model used (e.g. `order:10001`,
 *                   `Billing Policy.pdf#p1`). Verified deterministically downstream by
 *                   Compliance Validation; the model cannot self-certify grounding.
 */
export const LlmDraftSchema = z.object({
  reply: z.string().min(1),
  citedRefs: z.array(z.string()).default([]),
});

/** One deterministic compliance check and its outcome. */
export const ComplianceCheckSchema = z.object({
  /** Stable check name, e.g. `cited_references_exist`. */
  name: z.string(),
  passed: z.boolean(),
  /** Human-readable explanation, kept free of raw PII. */
  detail: z.string().optional(),
});

/**
 * Result of Compliance Validation: whether the generated draft is safe to deliver, and the
 * per-check evidence. Deterministic — it applies no model and makes no business decision.
 */
export const ComplianceResultSchema = z.object({
  passed: z.boolean(),
  /** Set when validation fails, so the safety outcome is explainable. */
  reasonCode: z.enum(REASON_CODES).optional(),
  checks: z.array(ComplianceCheckSchema).default([]),
});

/** A single piece of evidence the delivered draft cited, tagged by its source path. */
export const CitedEvidenceSchema = z.object({
  ref: z.string(),
  source: z.enum(['structured', 'policy']),
});

/**
 * The Structured JSON Output of Phase 6 — Response Generation. It echoes the Decision Gate
 * result unchanged (Response Generation never alters a business decision), and adds the
 * generated draft, the evidence it cited and the deterministic compliance outcome.
 *
 * `draft` is the German reply only when `delivered` is true (a compliant draft for an
 * `AUTO_REPLY` or `ASK_FOR_MORE_INFORMATION`). It is null whenever no draft is delivered:
 * a human escalation, an LLM failure, or a draft that failed Compliance Validation. In those
 * cases the case is handled by a human — the safe fallback.
 *
 * Note: the full audit trace (Phase 7) is deliberately not included here.
 */
export const GeneratedResponseSchema = z.object({
  caseId: z.string().optional(),
  /** The customer-facing language, detected from the email (German or English). */
  language: z.enum(['de', 'en']),
  /** Exact response prompt template associated with this stage outcome. */
  promptVersion: z.literal('response-generation/v2'),
  /** The Decision Gate outcome, carried through unchanged. */
  decision: DecisionSchema,
  /** The customer reply in the detected language when delivered, otherwise null. */
  draft: z.string().nullable(),
  /** True only when a compliant draft is being returned to the customer. */
  delivered: z.boolean(),
  citedEvidence: z.array(CitedEvidenceSchema).default([]),
  compliance: ComplianceResultSchema,
});
