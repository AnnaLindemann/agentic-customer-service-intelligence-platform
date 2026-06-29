/**
 * Derived evaluation metrics (Phase 7).
 *
 * These are deterministic *heuristics* computed read-only from metadata that other stages
 * already produced. They never call a model, never touch raw content, and never feed back into
 * a decision — they only summarise risk for observability and the Phase 8 workbench. Authoritative
 * quality measurement is Phase 9 (System Evaluation); treat these as indicators, not verdicts.
 */
import { Decision, Intent } from '../../domain';
import type {
  ComplianceAuditMetadata,
  DecisionAuditMetadata,
  EvaluationMetrics,
} from '../../types';

/** True when a customer-facing draft was actually delivered. */
function wasDelivered(decision: DecisionAuditMetadata): boolean {
  return (
    decision.finalOutcome === 'auto_replied' ||
    decision.finalOutcome === 'information_requested'
  );
}

/** Whether escalating (or not) lines up with the conditions that should drive escalation. */
function escalationCorrectness(
  decision: DecisionAuditMetadata,
  compliance: ComplianceAuditMetadata,
): EvaluationMetrics['escalationCorrectness'] {
  const escalationSignal =
    decision.scopeStatus === 'out_of_scope' ||
    !decision.dataSufficiency.sufficient ||
    decision.intent === Intent.UNKNOWN ||
    decision.intent === Intent.OUT_OF_SCOPE ||
    decision.businessRules.failed > 0;

  switch (decision.finalDecision) {
    case Decision.HUMAN_ESCALATION:
      return escalationSignal ? 'correct' : 'review';
    case Decision.AUTO_REPLY:
      return compliance.compliancePassed && decision.dataSufficiency.sufficient
        ? 'correct'
        : 'review';
    case Decision.ASK_FOR_MORE_INFORMATION:
      return !decision.dataSufficiency.sufficient ||
        decision.dataSufficiency.missingInformation.length > 0
        ? 'correct'
        : 'review';
    default:
      return 'not_applicable';
  }
}

/** Compute the derived evaluation signals from the recorded decision + compliance metadata. */
export function deriveEvaluationMetrics(
  decision: DecisionAuditMetadata,
  compliance: ComplianceAuditMetadata,
): EvaluationMetrics {
  const delivered = wasDelivered(decision);

  const groundingStatus: EvaluationMetrics['groundingStatus'] = !delivered
    ? 'not_applicable'
    : compliance.groundingStatus === 'grounded' && compliance.citedEvidenceCount > 0
      ? 'grounded'
      : compliance.citedEvidenceCount > 0
        ? 'partial'
        : 'ungrounded';

  const hallucinationRisk: EvaluationMetrics['hallucinationRisk'] = !delivered
    ? 'low'
    : !compliance.compliancePassed
      ? 'high'
      : groundingStatus === 'grounded'
        ? 'low'
        : 'medium';

  const completenessStatus: EvaluationMetrics['completenessStatus'] =
    decision.dataSufficiency.sufficient ? 'complete' : 'incomplete';

  const isAutoReply = decision.finalDecision === Decision.AUTO_REPLY && delivered;
  const unsupportedAutoReplyRisk: EvaluationMetrics['unsupportedAutoReplyRisk'] = !isAutoReply
    ? 'low'
    : compliance.unsupportedPromiseCheckResult === 'fail'
      ? 'high'
      : groundingStatus !== 'grounded'
        ? 'medium'
        : 'low';

  const piiLeakageRisk: EvaluationMetrics['piiLeakageRisk'] =
    compliance.piiLeakCheckResult === 'fail' ? 'high' : 'low';

  const escalation = escalationCorrectness(decision, compliance);

  const anyHigh =
    piiLeakageRisk === 'high' ||
    hallucinationRisk === 'high' ||
    unsupportedAutoReplyRisk === 'high';
  const anyReview =
    escalation === 'review' ||
    hallucinationRisk === 'medium' ||
    unsupportedAutoReplyRisk === 'medium' ||
    groundingStatus === 'partial';

  const overallSafetyStatus: EvaluationMetrics['overallSafetyStatus'] = anyHigh
    ? 'unsafe'
    : anyReview
      ? 'review'
      : 'safe';

  return {
    hallucinationRisk,
    groundingStatus,
    completenessStatus,
    escalationCorrectness: escalation,
    unsupportedAutoReplyRisk,
    piiLeakageRisk,
    overallSafetyStatus,
  };
}
