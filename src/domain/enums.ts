/**
 * Domain enums — the internal vocabulary of the pipeline.
 *
 * Each enum is expressed three ways from a single declaration:
 *   - a frozen const object for ergonomic, typo-safe named access (e.g. `Decision.AUTO_REPLY`);
 *   - a union type of the literal values (e.g. `type Decision`);
 *   - a runtime tuple of the values (e.g. `DECISIONS`) for building Zod enum schemas.
 *
 * These are pure values with no dependency on Zod, so the domain vocabulary stays
 * framework-agnostic. Runtime validation is layered on top in `src/schemas`.
 */

/** Tuple of a const enum object's values, typed so it can seed `z.enum(...)`. */
type EnumValues<T extends Record<string, string>> = [T[keyof T], ...T[keyof T][]];

/** The customer intent inferred from an email by the Intent Classification stage. */
export const Intent = {
  CANCELLATION_REQUEST: 'cancellation_request',
  DAMAGED_ITEM: 'damaged_item',
  INVOICE_QUESTION: 'invoice_question',
  PRODUCT_AVAILABILITY: 'product_availability',
  UNKNOWN: 'unknown',
  OUT_OF_SCOPE: 'out_of_scope',
} as const;
export type Intent = (typeof Intent)[keyof typeof Intent];
export const INTENTS = Object.values(Intent) as EnumValues<typeof Intent>;

/** The business workflow an intent maps to during Scope Validation. */
export const Workflow = {
  CANCELLATION: 'cancellation',
  DAMAGED_ITEM: 'damaged_item',
  INVOICE: 'invoice',
  PRODUCT_AVAILABILITY: 'product_availability',
  UNSUPPORTED: 'unsupported',
} as const;
export type Workflow = (typeof Workflow)[keyof typeof Workflow];
export const WORKFLOWS = Object.values(Workflow) as EnumValues<typeof Workflow>;

/** The action chosen by the Decision Gate. */
export const Decision = {
  AUTO_REPLY: 'AUTO_REPLY',
  ASK_FOR_MORE_INFORMATION: 'ASK_FOR_MORE_INFORMATION',
  HUMAN_ESCALATION: 'HUMAN_ESCALATION',
} as const;
export type Decision = (typeof Decision)[keyof typeof Decision];
export const DECISIONS = Object.values(Decision) as EnumValues<typeof Decision>;

/** Risk level attached to a business-rule outcome or a decision. */
export const RiskLevel = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
} as const;
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];
export const RISK_LEVELS = Object.values(RiskLevel) as EnumValues<typeof RiskLevel>;

/**
 * Explainability codes. Every important decision records one of these so a human can
 * reconstruct *why* an outcome occurred (design principle 4).
 */
export const ReasonCode = {
  /** Intent maps to a supported workflow. */
  SUPPORTED_WORKFLOW: 'SUPPORTED_WORKFLOW',
  /** Intent could not be determined. */
  UNKNOWN_INTENT: 'UNKNOWN_INTENT',
  /** Intent is understood but not handled by this system. */
  OUT_OF_SCOPE: 'OUT_OF_SCOPE',
  /** A field required to act on the case is absent. */
  MISSING_REQUIRED_INFORMATION: 'MISSING_REQUIRED_INFORMATION',
  /** No grounding policy passage was retrieved. */
  POLICY_MISSING: 'POLICY_MISSING',
  /** Expected structured business data was not found. */
  STRUCTURED_DATA_MISSING: 'STRUCTURED_DATA_MISSING',
  /** Business rules produced a conflicting or disallowed result. */
  BUSINESS_RULE_CONFLICT: 'BUSINESS_RULE_CONFLICT',
  /** An LLM stage returned output that failed schema validation. */
  INVALID_LLM_OUTPUT: 'INVALID_LLM_OUTPUT',
  /** Personal data was detected by the PII Sanitizer. */
  PII_DETECTED: 'PII_DETECTED',
  /** All checks passed; an automatic reply is permitted. */
  AUTO_REPLY_ALLOWED: 'AUTO_REPLY_ALLOWED',
  /** Conditions require routing the case to a human. */
  ESCALATION_REQUIRED: 'ESCALATION_REQUIRED',
} as const;
export type ReasonCode = (typeof ReasonCode)[keyof typeof ReasonCode];
export const REASON_CODES = Object.values(ReasonCode) as EnumValues<typeof ReasonCode>;
