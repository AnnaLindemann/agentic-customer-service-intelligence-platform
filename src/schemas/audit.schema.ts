import { z } from 'zod';
import { DECISIONS, INTENTS, REASON_CODES, WORKFLOWS } from '../domain';
import { RankedIntentSchema } from './intent.schema';
import { EvaluationSummarySchema } from './evaluation.schema';

/** A single stage's contribution to the audit trail. */
export const AuditStageRecordSchema = z.object({
  /** Pipeline stage name, e.g. `DecisionGate`. */
  stage: z.string(),
  /** Short outcome label for the stage, e.g. `passed` or `escalate`. */
  result: z.string(),
  reasonCode: z.enum(REASON_CODES).optional(),
  /** ISO-8601 timestamp of when the stage ran. */
  at: z.string(),
});

/**
 * The ordered record of every stage, decision and reason code for a case, enabling a
 * human to reconstruct why an outcome occurred (design principle 4).
 *
 * This is the lightweight Phase 5/6 trace embedded in `FinalApiResponse`. The richer,
 * frontend-ready Phase 7 document is `AuditRecordSchema` below; it is produced passively
 * and never alters a decision.
 */
export const AuditTraceSchema = z.object({
  caseId: z.string(),
  stages: z.array(AuditStageRecordSchema).default([]),
});

// ---------------------------------------------------------------------------
// Phase 7 — Audit & Evaluation
//
// Every schema below is *passive metadata*: it records what happened during
// processing and is never read back into a decision. It deliberately stores no
// raw prompts, no raw completions and no raw PII. It is provider-neutral so that
// future providers (OpenAI, Anthropic) populate the same shape, and it is
// structured for the Phase 8 workbench to render directly.
// ---------------------------------------------------------------------------

/** Outcome of the JSON parse + Zod validation of a single LLM call. */
export const JsonValidationResultSchema = z.enum([
  'valid',
  'invalid_json',
  'schema_invalid',
  'transport_error',
  'not_applicable',
]);

/** Failure category of an LLM call, mirrored from `LlmError.kind`; null on success. */
export const LlmErrorKindSchema = z.enum(['config', 'transport', 'invalid_output']);

/** Who/what/when of one processed request. */
export const AuditExecutionSchema = z.object({
  executionId: z.string(),
  traceId: z.string(),
  /** ISO-8601 timestamp of when the audit record was assembled. */
  timestamp: z.string(),
  pipelineVersion: z.string(),
});

/**
 * Provider-neutral metadata for a single LLM call. Captured by the audit instrumentation
 * wrapper, never by a vendor SDK leaking into the pipeline. Prompt and completion bodies are
 * intentionally absent; `promptFingerprint` is a non-reversible hash so a prompt can be
 * correlated without being stored.
 */
export const LlmAuditMetadataSchema = z.object({
  /** Pipeline stage that issued the call, e.g. `IntentClassification`. */
  stage: z.string(),
  provider: z.string(),
  configuredModel: z.string(),
  actualModelReturned: z.string().nullable(),
  providerRequestId: z.string().nullable(),
  promptVersion: z.string().nullable(),
  /** Non-reversible hash of the prompt (system + user); never the prompt text itself. */
  promptFingerprint: z.string().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  totalTokens: z.number().nullable(),
  /** Null when pricing for the model is unknown — never an error. */
  estimatedCostUsd: z.number().nullable(),
  latencyMs: z.number(),
  retryCount: z.number(),
  jsonValidationResult: JsonValidationResultSchema,
  errorKind: LlmErrorKindSchema.nullable(),
});

/** Aggregate of every LLM call in the request, for at-a-glance cost/latency display. */
export const LlmTotalsSchema = z.object({
  callCount: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  /** Null when at least one used model had unknown pricing. */
  estimatedCostUsd: z.number().nullable(),
  latencyMs: z.number(),
  retryCount: z.number(),
});

/** Compact, PII-free summary of the extracted slots: which fields were found vs. missing. */
export const SlotsSummarySchema = z.object({
  present: z.array(z.string()).default([]),
  missing: z.array(z.string()).default([]),
});

/** Roll-up of the deterministic business rule outcomes. */
export const BusinessRuleSummarySchema = z.object({
  total: z.number(),
  passed: z.number(),
  failed: z.number(),
  reasonCodes: z.array(z.enum(REASON_CODES)).default([]),
});

/** The deterministic decision, recorded exactly as it was made (never modified here). */
export const DecisionAuditMetadataSchema = z.object({
  intent: z.enum(INTENTS),
  rankedIntents: z.array(RankedIntentSchema).default([]),
  extractedSlots: SlotsSummarySchema,
  workflow: z.enum(WORKFLOWS),
  scopeStatus: z.enum(['in_scope', 'out_of_scope']),
  dataSufficiency: EvaluationSummarySchema,
  businessRules: BusinessRuleSummarySchema,
  finalDecision: z.enum(DECISIONS),
  reasonCodes: z.array(z.enum(REASON_CODES)).default([]),
  finalOutcome: z.enum([
    'auto_replied',
    'information_requested',
    'escalated',
    'no_response_delivered',
  ]),
});

/** Outcome of a single deterministic compliance check, normalised for display. */
const CheckOutcomeSchema = z.enum(['pass', 'fail', 'not_checked']);

/** The deterministic compliance verdict over the generated draft. */
export const ComplianceAuditMetadataSchema = z.object({
  compliancePassed: z.boolean(),
  citedEvidenceCount: z.number(),
  failedChecks: z.array(z.string()).default([]),
  groundingStatus: z.enum(['grounded', 'ungrounded', 'not_applicable']),
  piiLeakCheckResult: CheckOutcomeSchema,
  languageCheckResult: CheckOutcomeSchema,
  unsupportedPromiseCheckResult: CheckOutcomeSchema,
});

/**
 * Derived evaluation signals. These are deterministic *heuristics* over the recorded metadata,
 * intended for observability and the Phase 8 workbench — not an authoritative quality measure
 * (that is Phase 9 — System Evaluation).
 */
export const EvaluationMetricsSchema = z.object({
  hallucinationRisk: z.enum(['low', 'medium', 'high']),
  groundingStatus: z.enum(['grounded', 'partial', 'ungrounded', 'not_applicable']),
  completenessStatus: z.enum(['complete', 'incomplete', 'not_applicable']),
  escalationCorrectness: z.enum(['correct', 'review', 'not_applicable']),
  unsupportedAutoReplyRisk: z.enum(['low', 'medium', 'high']),
  piiLeakageRisk: z.enum(['low', 'medium', 'high']),
  overallSafetyStatus: z.enum(['safe', 'review', 'unsafe']),
});

/**
 * The complete Phase 7 audit document for one processed request. It is assembled passively
 * from the outputs of stages that already ran, so it can never change a decision, and it is
 * shaped for the Phase 8 workbench to render a full reasoning timeline.
 */
export const AuditRecordSchema = z.object({
  execution: AuditExecutionSchema,
  caseId: z.string().optional(),
  llm: z.array(LlmAuditMetadataSchema).default([]),
  llmTotals: LlmTotalsSchema,
  decision: DecisionAuditMetadataSchema,
  compliance: ComplianceAuditMetadataSchema,
  evaluation: EvaluationMetricsSchema,
  /** Ordered, frontend-ready timeline of the stages that ran. */
  stages: z.array(AuditStageRecordSchema).default([]),
});
