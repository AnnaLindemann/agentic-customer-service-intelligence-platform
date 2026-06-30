/**
 * Decision Gate — the pipeline stage.
 *
 * Responsibility: return exactly one action — `AUTO_REPLY`, `ASK_FOR_MORE_INFORMATION` or
 * `HUMAN_ESCALATION` — from the deterministic signals produced upstream: workflow scope,
 * intent confidence, the Data Sufficiency Evaluation and the Business Rule Engine results.
 * It is the single point where the system commits to a lane (architecture: "Decision Gate
 * returns exactly one outcome ... based on rules, sufficiency and confidence").
 *
 * Policy (ADR-007 / ADR-014, "Human by Exception v2"): the system automates every interaction it
 * can handle safely. Escalation happens only when safe automation is genuinely impossible or
 * policy *explicitly* reserves the case for a human. The checks are ordered most-fundamental first
 * so the reason code names the *first* decisive cause:
 *
 *   1. Explicit escalation signal (dispute / chargeback / goodwill / fraud / legal)
 *                                      → HUMAN_ESCALATION   (policy reserves these for a human)
 *   2. Unknown / ambiguous intent      → ASK_FOR_MORE_INFORMATION (ask the customer to clarify)
 *   3. Out-of-scope / unsupported      → OUT_OF_SCOPE        (auto-close with a polite redirect;
 *                                        understood but not a customer-service request — no human)
 *   4. Insufficient evidence:
 *        - missing customer slot        → ASK_FOR_MORE_INFORMATION
 *        - referenced record unresolved → ASK_FOR_MORE_INFORMATION (confirm the identifier)
 *        - missing grounding policy     → HUMAN_ESCALATION (conservative safe fallback)
 *   5. Failed *blocking* business rule  → HUMAN_ESCALATION   (none today; informational rules
 *                                        instead shape which grounded reply is sent)
 *   6. Damaged item not yet delivered   → ASK_FOR_MORE_INFORMATION (confirm delivery & details)
 *   7. Everything else                  → AUTO_REPLY (eligible action confirmed, ineligible action
 *                                        explained with the alternative, or question answered)
 *
 * The output is validated against `DecisionSchema` (the Phase 2 contract).
 */
import { DecisionSchema } from '../../schemas';
import { Decision, Intent, ReasonCode, RiskLevel, Workflow } from '../../domain';
import type {
  BusinessRuleResult,
  DecisionResult,
  EvaluationSummary,
  RankedIntent,
} from '../../types';
import type { EscalationSignal } from './escalation-triggers';

/** Minimum confidence the top intent must reach before the gate trusts the classification. */
export const MIN_INTENT_CONFIDENCE = 0.5;
/** Minimum gap between the top two intents; a closer race is treated as ambiguous. */
export const MIN_INTENT_MARGIN = 0.15;

export interface DecisionGateInput {
  workflow: Workflow;
  intent: Intent;
  /** Ranked candidate intents from Top-N Ranking; used to detect ambiguity when present. */
  rankedIntents?: RankedIntent[];
  evaluation: EvaluationSummary;
  ruleResults: BusinessRuleResult[];
  /** Output of the Escalation-Trigger Guard; when triggered, the case is reserved for a human. */
  escalationSignal?: EscalationSignal;
  /**
   * Deterministic product-resolution status (product-availability workflow only). Distinguishes a
   * specific name with no catalogue match (`not_found` → auto-answer) from an under-specified or
   * ambiguous request (`underspecified`/`ambiguous` → ask). Absent when not a product question or
   * no product name was given.
   */
  productResolution?: 'resolved' | 'ambiguous' | 'underspecified' | 'not_found';
}

const RISK_ORDER: Record<RiskLevel, number> = {
  [RiskLevel.LOW]: 0,
  [RiskLevel.MEDIUM]: 1,
  [RiskLevel.HIGH]: 2,
};

/** The most severe risk level among a set of rule results (low when the set is empty). */
function highestRisk(rules: BusinessRuleResult[]): RiskLevel {
  return rules.reduce<RiskLevel>(
    (worst, rule) => (RISK_ORDER[rule.riskLevel] > RISK_ORDER[worst] ? rule.riskLevel : worst),
    RiskLevel.LOW,
  );
}

/**
 * Is the intent classification too uncertain to act on? True when the top intent is below the
 * confidence floor, or when the top two candidates are within the ambiguity margin. When no
 * ranking is supplied the gate makes no confidence judgement (returns false).
 */
function isAmbiguous(ranked?: RankedIntent[]): boolean {
  if (!ranked || ranked.length === 0) return false;
  const sorted = [...ranked].sort((a, b) => b.confidence - a.confidence);
  if (sorted[0].confidence < MIN_INTENT_CONFIDENCE) return true;
  const second = sorted[1];
  return second !== undefined && sorted[0].confidence - second.confidence < MIN_INTENT_MARGIN;
}

function result(
  decision: Decision,
  riskLevel: RiskLevel,
  reasonCode: ReasonCode,
  rationale: string,
): DecisionResult {
  return DecisionSchema.parse({ decision, riskLevel, reasonCode, rationale });
}

/** A failed rule counts as blocking only when explicitly marked so (ADR-014). */
function isBlocking(rule: BusinessRuleResult): boolean {
  return rule.kind === 'blocking';
}

/**
 * Human-readable rationale for an `AUTO_REPLY`, naming the informational outcome so the audit
 * trail (and the Workbench "why" panel) explain *which* grounded reply is being sent.
 */
function autoReplyRationale(workflow: Workflow, ruleResults: BusinessRuleResult[]): string {
  const failed = ruleResults.filter((rule) => !rule.passed);
  switch (workflow) {
    case Workflow.CANCELLATION:
      return failed.length === 0
        ? 'Order is eligible for cancellation; confirming the cancellation and opening a case.'
        : 'Order is no longer eligible for self-service cancellation; explaining the policy and the return-after-delivery path.';
    case Workflow.DAMAGED_ITEM:
      return 'Delivered order; opening a return/replacement case and requesting the required evidence.';
    case Workflow.INVOICE:
      return 'Invoice located; answering the billing question from the stored record and policy.';
    case Workflow.PRODUCT_AVAILABILITY:
      return 'Product located in the catalogue; answering availability from inventory data.';
    default:
      return 'Scope, confidence and data sufficiency all passed; replying automatically.';
  }
}

/** Choose exactly one action for the case. See the module header for the ordering rationale. */
export function decide(input: DecisionGateInput): DecisionResult {
  const { workflow, intent, rankedIntents, evaluation, ruleResults, escalationSignal, productResolution } =
    input;

  // 1. Explicit escalation signal — policy reserves disputes/chargebacks/goodwill/fraud/legal
  //    for a human, regardless of how eligible the underlying request would otherwise be.
  if (escalationSignal?.triggered) {
    return result(
      Decision.HUMAN_ESCALATION,
      RiskLevel.HIGH,
      ReasonCode.ESCALATION_REQUIRED,
      `Manual review required: a '${escalationSignal.category}' signal was detected in the request.`,
    );
  }

  // 2. Unknown or ambiguous intent — ask the customer to clarify rather than escalate (v2).
  //    Checked before scope: an unknown intent also has an `unsupported` workflow, but it is
  //    recoverable by a clarifying question, not a redirect.
  if (intent === Intent.UNKNOWN || isAmbiguous(rankedIntents)) {
    return result(
      Decision.ASK_FOR_MORE_INFORMATION,
      RiskLevel.LOW,
      ReasonCode.UNKNOWN_INTENT,
      'Intent is unclear or ambiguous; asking the customer to clarify their request.',
    );
  }

  // 3. Understood but out of scope (e.g. a job application). Auto-close with a polite redirect to
  //    the correct contact — no human agent is required (ADR-014). Distinct from HUMAN_ESCALATION.
  if (workflow === Workflow.UNSUPPORTED || intent === Intent.OUT_OF_SCOPE) {
    return result(
      Decision.OUT_OF_SCOPE,
      RiskLevel.LOW,
      ReasonCode.OUT_OF_SCOPE,
      'Request is understood but outside customer-service scope; redirecting to the correct contact.',
    );
  }

  // 3b. Product-availability resolution (deterministic). When a product name was understood but
  //     does not uniquely resolve, the outcome depends on *why* — this is decided here rather than
  //     as a generic "structured data missing" gap:
  //       - not_found      → the catalogue has no such product: auto-answer (PRODUCT_NOT_FOUND);
  //       - ambiguous      → several products match: ask which one;
  //       - underspecified → a generic category: ask for the specific product.
  //     `resolved` falls through (the product fact is present, so sufficiency passes → AUTO_REPLY).
  if (workflow === Workflow.PRODUCT_AVAILABILITY && productResolution) {
    if (productResolution === 'not_found') {
      return result(
        Decision.AUTO_REPLY,
        RiskLevel.LOW,
        ReasonCode.PRODUCT_NOT_FOUND,
        'Product name understood, but no matching product exists in the catalogue.',
      );
    }
    if (productResolution === 'ambiguous') {
      return result(
        Decision.ASK_FOR_MORE_INFORMATION,
        RiskLevel.LOW,
        ReasonCode.MISSING_REQUIRED_INFORMATION,
        'Several catalogue products match; asking the customer which one they mean.',
      );
    }
    if (productResolution === 'underspecified') {
      return result(
        Decision.ASK_FOR_MORE_INFORMATION,
        RiskLevel.LOW,
        ReasonCode.MISSING_REQUIRED_INFORMATION,
        'Request names a generic product category; asking for the specific product.',
      );
    }
  }

  // 4. Insufficient evidence. A missing customer slot or an unresolved referenced record can both
  //    be recovered by asking the customer; only missing grounding policy falls back to a human
  //    (v2 keeps grounding conservative — no hard-coded policy fallback yet).
  if (!evaluation.sufficient) {
    const gaps = evaluation.missingInformation.join(', ') || 'required evidence';
    if (evaluation.reasonCode === ReasonCode.MISSING_REQUIRED_INFORMATION) {
      return result(
        Decision.ASK_FOR_MORE_INFORMATION,
        RiskLevel.LOW,
        ReasonCode.MISSING_REQUIRED_INFORMATION,
        `Missing required information from the customer: ${gaps}.`,
      );
    }
    if (evaluation.reasonCode === ReasonCode.STRUCTURED_DATA_MISSING) {
      return result(
        Decision.ASK_FOR_MORE_INFORMATION,
        RiskLevel.LOW,
        ReasonCode.STRUCTURED_DATA_MISSING,
        `The referenced record could not be located; asking the customer to confirm: ${gaps}.`,
      );
    }
    return result(
      Decision.HUMAN_ESCALATION,
      RiskLevel.MEDIUM,
      evaluation.reasonCode,
      `Required grounding evidence is unavailable to answer safely: ${gaps}.`,
    );
  }

  // 5. A failed *blocking* business rule is a genuine policy conflict (none today). Informational
  //    rules that "fail" are not handled here — they shape the AUTO_REPLY message in step 7.
  const blockingFailed = ruleResults.filter((rule) => !rule.passed && isBlocking(rule));
  if (blockingFailed.length > 0) {
    return result(
      Decision.HUMAN_ESCALATION,
      highestRisk(blockingFailed),
      ReasonCode.BUSINESS_RULE_CONFLICT,
      `Blocking business rule(s) not satisfied: ${blockingFailed.map((rule) => rule.ruleId).join(', ')}.`,
    );
  }

  // 6. Damaged-item intake where delivery is not yet confirmed: ask the customer to confirm the
  //    order and delivery details rather than escalate (the case stays automatable).
  if (workflow === Workflow.DAMAGED_ITEM) {
    const deliveredRule = ruleResults.find((rule) => rule.ruleId === 'damaged_item.order_delivered');
    if (deliveredRule && !deliveredRule.passed) {
      return result(
        Decision.ASK_FOR_MORE_INFORMATION,
        RiskLevel.LOW,
        ReasonCode.MISSING_REQUIRED_INFORMATION,
        'Order is not marked delivered; asking the customer to confirm the order and delivery details.',
      );
    }
  }

  // 7. Safe to automate — confirm an eligible action, explain an ineligible one with the
  //    alternative, or answer the question. Informational rule outcomes shape the message.
  return result(
    Decision.AUTO_REPLY,
    RiskLevel.LOW,
    ReasonCode.AUTO_REPLY_ALLOWED,
    autoReplyRationale(workflow, ruleResults),
  );
}
