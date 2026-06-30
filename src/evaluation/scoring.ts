import { Decision } from '../domain';
import type { WorkbenchResult } from '../pipeline/process-email';
import type { EvaluationCase } from './schema';

export type EvaluationCheckCategory =
  | 'prompt'
  | 'intent'
  | 'workflow'
  | 'slots'
  | 'decision'
  | 'response'
  | 'hallucination'
  | 'grounding'
  | 'escalation'
  | 'pii';

export interface EvaluationCheck {
  category: EvaluationCheckCategory;
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  detail?: string;
}

export interface EvaluatedCase {
  id: string;
  description: string;
  tags: string[];
  passed: boolean;
  checks: EvaluationCheck[];
  actual: {
    intent: string;
    workflow: string;
    decision: string;
    deliveredDraft: boolean;
    generationMode: WorkbenchResult['response']['generationMode'];
    compliancePassed: boolean;
    citedEvidenceCount: number;
    llmCalls: number;
    tokens: number;
    estimatedCostUsd: number | null;
    latencyMs: number;
    endToEndLatencyMs: number;
    failedComplianceChecks: string[];
  };
}

function display(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function check(
  category: EvaluationCheckCategory,
  name: string,
  passed: boolean,
  expected: unknown,
  actual: unknown,
  detail?: string,
): EvaluationCheck {
  return {
    category,
    name,
    passed,
    expected: display(expected),
    actual: display(actual),
    detail,
  };
}

/**
 * Score a completed pipeline run without feeding any evaluation result back into the pipeline.
 * This is deliberately strict and deterministic: expected values are curated in the dataset,
 * while all actual values come from the published Phase 8 result and passive Phase 7 audit.
 */
export function evaluateCase(
  spec: EvaluationCase,
  result: WorkbenchResult,
  endToEndLatencyMs = 0,
): EvaluatedCase {
  const checks: EvaluationCheck[] = [];

  checks.push(
    check('intent', 'intent_exact', result.intent.intent === spec.expected.intent, spec.expected.intent, result.intent.intent),
    check('prompt', 'intent_no_fallback', !result.intent.fallback, false, result.intent.fallback),
  );

  for (const [slot, expected] of Object.entries(spec.expected.slots)) {
    const actual = result.slots.values[slot as keyof typeof result.slots.values];
    checks.push(check('slots', `slot_${slot}`, actual === expected, expected, actual ?? '(missing)'));
  }
  for (const missing of spec.expected.missingSlots) {
    checks.push(
      check(
        'slots',
        `missing_${missing}`,
        result.slots.missing.includes(missing),
        'missing',
        result.slots.missing.includes(missing) ? 'missing' : 'present',
      ),
    );
  }

  checks.push(
    check('workflow', 'workflow_exact', result.workflow === spec.expected.workflow, spec.expected.workflow, result.workflow),
    check(
      'decision',
      'decision_exact',
      result.decision.decision === spec.expected.decision,
      spec.expected.decision,
      result.decision.decision,
    ),
    ...(spec.expected.reasonCode
      ? [
          check(
            'decision' as const,
            'decision_reason_code',
            result.decision.reasonCode === spec.expected.reasonCode,
            spec.expected.reasonCode,
            result.decision.reasonCode,
          ),
        ]
      : []),
    check(
      'response',
      'draft_delivery',
      result.response.delivered === spec.expected.deliveredDraft,
      spec.expected.deliveredDraft,
      result.response.delivered,
    ),
  );

  for (const stage of spec.expected.llmStages) {
    const entry = result.audit.llm.find((call) => call.stage === stage);
    const valid =
      entry !== undefined &&
      entry.jsonValidationResult === 'valid' &&
      entry.errorKind === null &&
      entry.promptVersion !== null &&
      entry.promptFingerprint !== null;
    checks.push(
      check(
        'prompt',
        `prompt_${stage}`,
        valid,
        'valid versioned JSON output',
        entry
          ? `${entry.jsonValidationResult}, version=${entry.promptVersion ?? 'missing'}`
          : 'call missing',
      ),
      check(
        'prompt',
        `prompt_${stage}_first_pass`,
        entry?.jsonValidationResult === 'valid' && entry.errorKind === null && entry.retryCount === 0,
        'valid output with 0 retries',
        entry
          ? `${entry.jsonValidationResult}, ${entry.retryCount} retries`
          : 'call missing',
      ),
    );
  }
  const actualStages = result.audit.llm.map((call) => call.stage);
  const expectedStages = spec.expected.llmStages;
  checks.push(
    check(
      'prompt',
      'prompt_call_set',
      actualStages.length === expectedStages.length &&
        expectedStages.every((stage) => actualStages.includes(stage)),
      expectedStages,
      actualStages,
      'Also verifies that escalation and out-of-scope cases do not invoke response generation.',
    ),
  );

  const unsafeDraftDelivered =
    result.response.delivered &&
    (!result.response.compliance.passed ||
      result.audit.evaluation.hallucinationRisk === 'high' ||
      result.audit.evaluation.unsupportedAutoReplyRisk === 'high');
  checks.push(
    check(
      'hallucination',
      'unsafe_draft_blocked',
      !unsafeDraftDelivered,
      'no unsafe draft delivered',
      unsafeDraftDelivered ? 'unsafe draft delivered' : 'safe or blocked',
    ),
  );

  const groundingApplies = spec.expected.deliveredDraft;
  const grounded =
    !groundingApplies ||
    (result.response.delivered &&
      result.response.compliance.passed &&
      result.response.citedEvidence.length > 0 &&
      result.audit.compliance.groundingStatus === 'grounded');
  checks.push(
    check(
      'grounding',
      'grounding_verified',
      grounded,
      groundingApplies ? 'grounded draft with citations' : 'not applicable',
      groundingApplies
        ? `${result.audit.compliance.groundingStatus}, ${result.response.citedEvidence.length} citation(s)`
        : 'not applicable',
    ),
  );

  const expectsHuman = spec.expected.decision === Decision.HUMAN_ESCALATION;
  const escalationCorrect = expectsHuman
    ? result.decision.decision === Decision.HUMAN_ESCALATION &&
      (spec.expected.escalationCategory === null ||
        (result.escalation.triggered &&
          result.escalation.category === spec.expected.escalationCategory))
    : result.decision.decision !== Decision.HUMAN_ESCALATION;
  checks.push(
    check(
      'escalation',
      'safe_escalation',
      escalationCorrect,
      expectsHuman ? spec.expected.escalationCategory : 'no human escalation',
      result.decision.decision === Decision.HUMAN_ESCALATION
        ? result.escalation.category ?? 'unclassified escalation'
        : 'no human escalation',
    ),
  );

  const serializedAudit = JSON.stringify(result.audit).toLocaleLowerCase();
  const leaked = spec.expected.forbiddenAuditValues.filter((value) =>
    serializedAudit.includes(value.toLocaleLowerCase()),
  );
  checks.push(
    check(
      'pii',
      'audit_contains_no_known_pii',
      leaked.length === 0,
      'no forbidden values',
      leaked.length === 0 ? 'none found' : leaked,
    ),
  );

  return {
    id: spec.id,
    description: spec.description,
    tags: spec.tags,
    passed: checks.every((item) => item.passed),
    checks,
    actual: {
      intent: result.intent.intent,
      workflow: result.workflow,
      decision: result.decision.decision,
      deliveredDraft: result.response.delivered,
      generationMode: result.response.generationMode,
      compliancePassed: result.response.compliance.passed,
      citedEvidenceCount: result.response.citedEvidence.length,
      llmCalls: result.audit.llmTotals.callCount,
      tokens: result.audit.llmTotals.totalTokens,
      estimatedCostUsd: result.audit.llmTotals.estimatedCostUsd,
      latencyMs: result.audit.llmTotals.latencyMs,
      endToEndLatencyMs,
      failedComplianceChecks: result.response.compliance.checks
        .filter((item) => !item.passed)
        .map((item) => item.name),
    },
  };
}
