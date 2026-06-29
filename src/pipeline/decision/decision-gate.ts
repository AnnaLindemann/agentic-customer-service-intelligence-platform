/**
 * Decision Gate — the pipeline stage.
 *
 * Responsibility: return exactly one action — `AUTO_REPLY`, `ASK_FOR_MORE_INFORMATION` or
 * `HUMAN_ESCALATION` — from the deterministic signals produced upstream: workflow scope,
 * intent confidence, the Data Sufficiency Evaluation and the Business Rule Engine results.
 * It is the single point where the system commits to a lane (architecture: "Decision Gate
 * returns exactly one outcome ... based on rules, sufficiency and confidence").
 *
 * Policy (ADR-007, "Human by Exception"): `AUTO_REPLY` is the goal whenever every
 * deterministic check passes; escalation is the safety fallback, not the default. The checks
 * are ordered most-fundamental first so the reason code names the *first* blocking cause:
 *
 *   1. Out-of-scope / unknown intent  → HUMAN_ESCALATION   (cannot be handled at all)
 *   2. Ambiguous / low-confidence intent → HUMAN_ESCALATION (we are unsure what was asked)
 *   3. Insufficient evidence           → ASK_FOR_MORE_INFORMATION when the *customer* can
 *                                        supply it, else HUMAN_ESCALATION
 *   4. Business-rule conflict          → HUMAN_ESCALATION   (policy does not permit the action)
 *   5. Everything passed               → AUTO_REPLY
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

/** Choose exactly one action for the case. See the module header for the ordering rationale. */
export function decide(input: DecisionGateInput): DecisionResult {
  const { workflow, intent, rankedIntents, evaluation, ruleResults } = input;

  // 1. Out of scope — a safety net; Scope Validation should normally catch this first.
  if (workflow === Workflow.UNSUPPORTED || intent === Intent.OUT_OF_SCOPE) {
    return result(
      Decision.HUMAN_ESCALATION,
      RiskLevel.HIGH,
      ReasonCode.OUT_OF_SCOPE,
      'Intent does not map to a supported workflow.',
    );
  }
  if (intent === Intent.UNKNOWN) {
    return result(
      Decision.HUMAN_ESCALATION,
      RiskLevel.HIGH,
      ReasonCode.UNKNOWN_INTENT,
      'Intent could not be determined.',
    );
  }

  // 2. Ambiguous / low-confidence classification.
  if (isAmbiguous(rankedIntents)) {
    return result(
      Decision.HUMAN_ESCALATION,
      RiskLevel.MEDIUM,
      ReasonCode.UNKNOWN_INTENT,
      'Intent classification is ambiguous or below the confidence threshold.',
    );
  }

  // 3. Insufficient evidence. A missing customer slot can be requested; missing structured
  //    data or policy evidence cannot be self-served and must go to a human.
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
    return result(
      Decision.HUMAN_ESCALATION,
      RiskLevel.MEDIUM,
      evaluation.reasonCode,
      `Required evidence could not be retrieved to answer safely: ${gaps}.`,
    );
  }

  // 4. Business-rule conflict — policy does not permit the requested action.
  const failed = ruleResults.filter((rule) => !rule.passed);
  if (failed.length > 0) {
    return result(
      Decision.HUMAN_ESCALATION,
      highestRisk(failed),
      ReasonCode.BUSINESS_RULE_CONFLICT,
      `Business rule(s) not satisfied: ${failed.map((rule) => rule.ruleId).join(', ')}.`,
    );
  }

  // 5. All deterministic checks passed — safe to auto-reply.
  return result(
    Decision.AUTO_REPLY,
    RiskLevel.LOW,
    ReasonCode.AUTO_REPLY_ALLOWED,
    'Scope, confidence, data sufficiency and business rules all passed.',
  );
}
