/**
 * Decision Engine — composes the three Phase 5 decision stages into one result.
 *
 * Responsibility: run Data Sufficiency Evaluation, the Business Rule Engine and the Decision
 * Gate in order, and return a single schema-validated bundle (`DecisionEngineResultSchema`):
 * `{ caseId?, evaluation, ruleResults, decision }`. This mirrors how the Hybrid Retrieval
 * Layer packages its sub-stages into one contract (ADR-009), so downstream consumers
 * (Response Generation, Audit) depend on one shape rather than three.
 *
 * The whole engine is deterministic and synchronous: no LLM call, no I/O, no model load. It
 * consumes the evidence assembled by Retrieval and the classification produced upstream, and
 * produces a decision. It generates no customer-facing text (that is Phase 6).
 *
 * Stage order matters and is fixed: sufficiency is evaluated first (rules and the gate rely on
 * the required records being present), then rules, then the gate combines every signal.
 */
import { DecisionEngineResultSchema } from '../../schemas';
import type {
  DecisionEngineResult,
  ExtractedSlots,
  Intent,
  RankedIntent,
  RetrievedSource,
  StructuredSource,
  Workflow,
} from '../../types';
import { evaluateDataSufficiency } from './data-sufficiency';
import { applyBusinessRules } from './business-rules';
import { decide } from './decision-gate';
import type { EscalationSignal } from './escalation-triggers';

export interface DecisionEngineInput {
  /** The originating case id, recorded on the output when present. */
  caseId?: string;
  workflow: Workflow;
  intent: Intent;
  /** Slots extracted from the email (carried through to rules that need stated values). */
  slots: ExtractedSlots;
  /** Required customer slots Workflow Enrichment found missing. */
  missingInformation: string[];
  /** Structured business facts from Structured Data Retrieval. */
  structuredFacts: StructuredSource[];
  /** Policy passages from Semantic PDF Retrieval. */
  policyEvidence: RetrievedSource[];
  /** Ranked candidate intents; used by the gate to detect ambiguity when present. */
  rankedIntents?: RankedIntent[];
  /**
   * Output of the Escalation-Trigger Guard (ADR-014). When triggered, the gate reserves the case
   * for a human regardless of eligibility. Computed by the orchestrator from the masked email.
   */
  escalationSignal?: EscalationSignal;
  /** Deterministic product-resolution status (product-availability workflow only). */
  productResolution?: 'resolved' | 'ambiguous' | 'underspecified' | 'not_found';
  /** Evaluation time, injectable for deterministic testing. Defaults to now. */
  now?: Date;
}

/**
 * Run the Decision Engine for a case and return the combined decision bundle.
 *
 * The result conforms to `DecisionEngineResultSchema`: the sufficiency summary, every business
 * rule outcome (passed and failed, for the audit trail), and exactly one gate decision.
 */
export function runDecisionEngine(input: DecisionEngineInput): DecisionEngineResult {
  const evaluation = evaluateDataSufficiency({
    workflow: input.workflow,
    missingInformation: input.missingInformation,
    structuredFacts: input.structuredFacts,
    policyEvidence: input.policyEvidence,
  });

  const ruleResults = applyBusinessRules({
    workflow: input.workflow,
    slots: input.slots,
    structuredFacts: input.structuredFacts,
    now: input.now,
  });

  const decision = decide({
    workflow: input.workflow,
    intent: input.intent,
    rankedIntents: input.rankedIntents,
    evaluation,
    ruleResults,
    escalationSignal: input.escalationSignal,
    productResolution: input.productResolution,
  });

  return DecisionEngineResultSchema.parse({
    caseId: input.caseId,
    evaluation,
    ruleResults,
    decision,
  });
}
