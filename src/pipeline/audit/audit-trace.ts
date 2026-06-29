/**
 * Audit Trace assembler (Phase 7).
 *
 * Builds the complete, frontend-ready `AuditRecord` for one processed request *passively*: it
 * reads the outputs that earlier stages already produced and composes a structured summary. It
 * holds these invariants by construction:
 *
 *   - It never makes or changes a decision — every decision value is copied through verbatim.
 *   - It stores no raw prompt, no raw completion and no raw PII — only counts, codes, statuses
 *     and a non-reversible prompt fingerprint (added upstream by the LLM recorder).
 *   - It never throws on missing inputs — absent optional data degrades to safe defaults so a
 *     thin audit record can still be produced.
 *
 * The shape is provider-neutral and validated against `AuditRecordSchema`, so the Phase 8
 * workbench can render the full reasoning timeline directly.
 */
import { randomUUID } from 'node:crypto';
import { Decision, Workflow } from '../../domain';
import { AuditRecordSchema } from '../../schemas';
import type {
  AuditRecord,
  AuditStageRecord,
  BusinessRuleResult,
  ComplianceAuditMetadata,
  DecisionAuditMetadata,
  DecisionEngineResult,
  GeneratedResponse,
  IntentClassification,
  LlmAuditMetadata,
  LlmTotals,
  ReasonCode,
  SlotExtraction,
  Workflow as WorkflowType,
} from '../../types';
import { deriveEvaluationMetrics } from './evaluation-metrics';

/** Bumped when the pipeline composition changes; recorded on every audit record. */
export const PIPELINE_VERSION = 'mvp/v1';

export interface BuildAuditTraceInput {
  caseId?: string;
  /** Execution identity; any field omitted is generated (ids) or defaulted. */
  executionId?: string;
  traceId?: string;
  pipelineVersion?: string;
  /** Assembly time, injectable for deterministic tests. Defaults to now. */
  now?: Date;
  /** Per-call LLM metadata, typically `recorder.entries()`. */
  llm?: LlmAuditMetadata[];
  /** Intent Classification + Top-N Ranking output. */
  classification: IntentClassification;
  /** Slot Extraction output (summarised; raw values are not stored). */
  slots: SlotExtraction;
  workflow: WorkflowType;
  /** Combined Decision Engine output (sufficiency + rules + gate decision). */
  decisionEngine: DecisionEngineResult;
  /** Response Generation output; absent when no response stage ran. */
  response?: GeneratedResponse;
  /** Optional pre-built stage timeline (the orchestrator supplies it); defaults to empty. */
  stages?: AuditStageRecord[];
}

/** Append a value to an ordered set, preserving first-seen order. */
function pushUnique<T>(into: T[], value: T | undefined): void {
  if (value !== undefined && !into.includes(value)) into.push(value);
}

function summariseRules(ruleResults: BusinessRuleResult[]): DecisionAuditMetadata['businessRules'] {
  const reasonCodes: ReasonCode[] = [];
  let passed = 0;
  for (const rule of ruleResults) {
    if (rule.passed) passed += 1;
    pushUnique(reasonCodes, rule.reasonCode);
  }
  return {
    total: ruleResults.length,
    passed,
    failed: ruleResults.length - passed,
    reasonCodes,
  };
}

function determineFinalOutcome(
  decision: Decision,
  response: GeneratedResponse | undefined,
): DecisionAuditMetadata['finalOutcome'] {
  if (decision === Decision.HUMAN_ESCALATION) return 'escalated';
  if (response?.delivered) {
    return decision === Decision.AUTO_REPLY ? 'auto_replied' : 'information_requested';
  }
  return 'no_response_delivered';
}

/** Read one named compliance check and normalise it to pass / fail / not_checked. */
function checkOutcome(
  response: GeneratedResponse | undefined,
  name: string,
): ComplianceAuditMetadata['piiLeakCheckResult'] {
  const check = response?.compliance.checks.find((item) => item.name === name);
  if (!check) return 'not_checked';
  return check.passed ? 'pass' : 'fail';
}

function buildComplianceMetadata(
  response: GeneratedResponse | undefined,
): ComplianceAuditMetadata {
  if (!response) {
    return {
      compliancePassed: true,
      citedEvidenceCount: 0,
      failedChecks: [],
      groundingStatus: 'not_applicable',
      piiLeakCheckResult: 'not_checked',
      languageCheckResult: 'not_checked',
      unsupportedPromiseCheckResult: 'not_checked',
    };
  }

  const failedChecks = response.compliance.checks
    .filter((check) => !check.passed)
    .map((check) => check.name);

  // Grounding only applies when a draft was delivered; otherwise it is not a meaningful signal.
  const groundingCheck = checkOutcome(response, 'grounded_citations');
  const groundingStatus: ComplianceAuditMetadata['groundingStatus'] = !response.delivered
    ? 'not_applicable'
    : groundingCheck === 'pass'
      ? 'grounded'
      : 'ungrounded';

  return {
    compliancePassed: response.compliance.passed,
    citedEvidenceCount: response.citedEvidence.length,
    failedChecks,
    groundingStatus,
    piiLeakCheckResult: checkOutcome(response, 'no_pii_leakage'),
    languageCheckResult: checkOutcome(response, 'german_language'),
    unsupportedPromiseCheckResult: checkOutcome(response, 'no_unsupported_promises'),
  };
}

function buildDecisionMetadata(input: BuildAuditTraceInput): DecisionAuditMetadata {
  const { classification, slots, workflow, decisionEngine, response } = input;
  const { evaluation, ruleResults, decision } = decisionEngine;

  const reasonCodes: ReasonCode[] = [];
  pushUnique(reasonCodes, decision.reasonCode);
  pushUnique(reasonCodes, evaluation.reasonCode);
  for (const rule of ruleResults) pushUnique(reasonCodes, rule.reasonCode);
  pushUnique(reasonCodes, response?.compliance.reasonCode);

  return {
    intent: classification.intent,
    rankedIntents: classification.ranked,
    extractedSlots: {
      // Keys only: slot *values* (which may carry masked tokens) are never recorded.
      present: Object.keys(slots.slots),
      missing: slots.missing,
    },
    workflow,
    scopeStatus: workflow === Workflow.UNSUPPORTED ? 'out_of_scope' : 'in_scope',
    dataSufficiency: evaluation,
    businessRules: summariseRules(ruleResults),
    finalDecision: decision.decision,
    reasonCodes,
    finalOutcome: determineFinalOutcome(decision.decision, response),
  };
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function buildLlmTotals(records: LlmAuditMetadata[]): LlmTotals {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let latencyMs = 0;
  let retryCount = 0;
  let cost = 0;
  let pricingUnknown = false;

  for (const record of records) {
    inputTokens += record.inputTokens ?? 0;
    outputTokens += record.outputTokens ?? 0;
    totalTokens += record.totalTokens ?? 0;
    latencyMs += record.latencyMs;
    retryCount += record.retryCount;
    // Only calls that reported usage participate in the cost roll-up; an unknown price among
    // them makes the aggregate unknowable (null), never zero.
    if (record.totalTokens !== null) {
      if (record.estimatedCostUsd === null) pricingUnknown = true;
      else cost += record.estimatedCostUsd;
    }
  }

  return {
    callCount: records.length,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: pricingUnknown ? null : roundUsd(cost),
    latencyMs,
    retryCount,
  };
}

/**
 * Assemble the Phase 7 audit record for a processed request. Pure and read-only: it returns a
 * new `AuditRecord` and mutates none of its inputs, so it can never alter a decision.
 */
export function buildAuditTrace(input: BuildAuditTraceInput): AuditRecord {
  const now = input.now ?? new Date();
  const llm = input.llm ?? [];

  const decision = buildDecisionMetadata(input);
  const compliance = buildComplianceMetadata(input.response);
  const evaluation = deriveEvaluationMetrics(decision, compliance);

  return AuditRecordSchema.parse({
    execution: {
      executionId: input.executionId ?? randomUUID(),
      traceId: input.traceId ?? randomUUID(),
      timestamp: now.toISOString(),
      pipelineVersion: input.pipelineVersion ?? PIPELINE_VERSION,
    },
    caseId: input.caseId,
    llm,
    llmTotals: buildLlmTotals(llm),
    decision,
    compliance,
    evaluation,
    stages: input.stages ?? [],
  });
}
