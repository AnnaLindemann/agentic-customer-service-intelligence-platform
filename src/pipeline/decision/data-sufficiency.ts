/**
 * Data Sufficiency Evaluation — the pipeline stage.
 *
 * Responsibility: decide whether enough evidence exists to answer a case *safely*, before any
 * business rule runs or any draft is written (design principle 5: "no grounding means no
 * answer"). It is a deterministic check over what earlier stages produced — the required
 * customer slots, the structured business facts retrieved, and the policy evidence retrieved.
 *
 * It judges *presence of evidence*, not *business eligibility*. Whether a found order may be
 * cancelled is the Business Rule Engine's job; whether to act is the Decision Gate's. This
 * stage only answers: do we have what we need to proceed? (ADR-001: "LLMs interpret. Rules
 * decide.")
 *
 * The output is validated against `EvaluationSummarySchema` (the Phase 2 contract).
 */
import { EvaluationSummarySchema } from '../../schemas';
import { ReasonCode, type Workflow } from '../../domain';
import type { EvaluationSummary, RetrievedSource, StructuredSource } from '../../types';

/** The structured-fact kind a workflow must resolve before it can be answered. */
type StructuredKind = StructuredSource['kind'];

/** What each supported workflow needs in evidence before a case is answerable. */
interface WorkflowRequirement {
  /** Structured-fact kinds that must be present (e.g. an `order` record for a cancellation). */
  structured: StructuredKind[];
  /** Whether a grounding policy passage is required (most answers must cite policy). */
  policy: boolean;
}

/**
 * Evidence requirements per workflow. Product availability is answered purely from inventory
 * data, so it does not require a policy passage; the others must be grounded in policy.
 */
const REQUIREMENTS: Record<Workflow, WorkflowRequirement> = {
  cancellation: { structured: ['order'], policy: true },
  damaged_item: { structured: ['order'], policy: true },
  invoice: { structured: ['invoice'], policy: true },
  product_availability: { structured: ['product'], policy: false },
  unsupported: { structured: [], policy: false },
};

export interface SufficiencyInput {
  workflow: Workflow;
  /**
   * Required customer-supplied slots that Workflow Enrichment found missing (e.g. `orderId`).
   * These are things the *customer* can still provide, so they are reported first.
   */
  missingInformation: string[];
  /** Structured business facts returned by Structured Data Retrieval. */
  structuredFacts: StructuredSource[];
  /** Policy passages returned by Semantic PDF Retrieval. */
  policyEvidence: RetrievedSource[];
}

/**
 * Evaluate whether a case has enough evidence to be answered safely.
 *
 * The `missingInformation` on the result distinguishes two kinds of gap, which the Decision
 * Gate treats differently:
 *   - a missing *customer slot* (the customer never gave an order id) — recoverable by asking;
 *   - missing *evidence* the customer cannot supply (the order id was given but resolved to no
 *     record, or no grounding policy was found) — not recoverable by asking, needs a human.
 *
 * The `reasonCode` names the most salient gap, prioritised in that order so the gate can route
 * the case. When nothing is missing the result is `DATA_SUFFICIENT`.
 */
export function evaluateDataSufficiency(input: SufficiencyInput): EvaluationSummary {
  const reqs = REQUIREMENTS[input.workflow];

  const presentKinds = new Set(input.structuredFacts.map((fact) => fact.kind));
  const missingKinds = reqs.structured.filter((kind) => !presentKinds.has(kind));
  const hasStructuredData = missingKinds.length === 0;
  const hasPolicyEvidence = input.policyEvidence.length > 0;

  // Start from the slots the customer still owes us (from Workflow Enrichment). Only when the
  // customer supplied everything do we report evidence we could not resolve on our side — a
  // missing slot already implies its record could not be found, so we avoid double-reporting.
  const missingInformation = [...input.missingInformation];
  if (input.missingInformation.length === 0) {
    for (const kind of missingKinds) missingInformation.push(`${kind}_record`);
    if (reqs.policy && !hasPolicyEvidence) missingInformation.push('policy_evidence');
  }

  const sufficient = missingInformation.length === 0;

  let reasonCode: ReasonCode;
  if (sufficient) {
    reasonCode = ReasonCode.DATA_SUFFICIENT;
  } else if (input.missingInformation.length > 0) {
    reasonCode = ReasonCode.MISSING_REQUIRED_INFORMATION;
  } else if (!hasStructuredData) {
    reasonCode = ReasonCode.STRUCTURED_DATA_MISSING;
  } else {
    reasonCode = ReasonCode.POLICY_MISSING;
  }

  return EvaluationSummarySchema.parse({
    sufficient,
    reasonCode,
    missingInformation,
    hasStructuredData,
    hasPolicyEvidence,
  });
}
