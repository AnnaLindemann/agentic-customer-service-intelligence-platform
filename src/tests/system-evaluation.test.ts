import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Decision, Intent, Workflow } from '../domain';
import { EvaluationDatasetSchema, buildReport, evaluateCase, renderMarkdown } from '../evaluation';
import type { WorkbenchResult } from '../pipeline/process-email';

const dataset = EvaluationDatasetSchema.parse(
  JSON.parse(
    readFileSync(
      path.join(process.cwd(), 'data', 'evaluation', 'system-evaluation.json'),
      'utf8',
    ),
  ),
);

function passingResult(): WorkbenchResult {
  return {
    intent: {
      intent: Intent.PRODUCT_AVAILABILITY,
      confidence: 0.95,
      ranked: [{ intent: Intent.PRODUCT_AVAILABILITY, confidence: 0.95 }],
      fallback: false,
    },
    workflow: Workflow.PRODUCT_AVAILABILITY,
    slots: {
      present: ['productName'],
      missing: [],
      values: { productName: 'Vista 45L Backpack' },
    },
    decision: {
      decision: Decision.AUTO_REPLY,
      riskLevel: 'low',
      reasonCode: 'AUTO_REPLY_ALLOWED',
      rationale: 'grounded',
    },
    response: {
      language: 'de',
      promptVersion: 'response-generation/v2',
      decision: {
        decision: Decision.AUTO_REPLY,
        riskLevel: 'low',
        reasonCode: 'AUTO_REPLY_ALLOWED',
        rationale: 'grounded',
      },
      draft: 'Guten Tag, das Produkt ist verfügbar.',
      delivered: true,
      citedEvidence: [{ ref: 'policy:1', source: 'policy' }],
      compliance: { passed: true, checks: [] },
    },
    escalation: { triggered: false },
    audit: {
      execution: {
        executionId: 'execution-1',
        traceId: 'trace-1',
        timestamp: '2026-06-30T12:00:00.000Z',
        pipelineVersion: 'mvp/v1',
      },
      llm: ['IntentClassification', 'SlotExtraction', 'LlmDraft'].map((stage) => ({
        stage,
        provider: 'test',
        configuredModel: 'test-model',
        actualModelReturned: 'test-model',
        providerRequestId: null,
        promptVersion: 'v1',
        promptFingerprint: '0123456789abcdef',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        estimatedCostUsd: 0.00001,
        latencyMs: 10,
        retryCount: 0,
        jsonValidationResult: 'valid' as const,
        errorKind: null,
      })),
      llmTotals: {
        callCount: 3,
        inputTokens: 30,
        outputTokens: 15,
        totalTokens: 45,
        estimatedCostUsd: 0.00003,
        latencyMs: 30,
        retryCount: 0,
      },
      decision: {} as WorkbenchResult['audit']['decision'],
      compliance: {
        compliancePassed: true,
        citedEvidenceCount: 1,
        failedChecks: [],
        groundingStatus: 'grounded',
        piiLeakCheckResult: 'pass',
        languageCheckResult: 'pass',
        unsupportedPromiseCheckResult: 'pass',
      },
      evaluation: {
        hallucinationRisk: 'low',
        groundingStatus: 'grounded',
        completenessStatus: 'complete',
        escalationCorrectness: 'correct',
        unsupportedAutoReplyRisk: 'low',
        piiLeakageRisk: 'low',
        overallSafetyStatus: 'safe',
      },
      stages: [],
    },
  } as unknown as WorkbenchResult;
}

test('the synthetic dataset is schema-valid and covers all decision outcomes', () => {
  assert.ok(dataset.cases.length >= 10);
  const decisions = new Set(dataset.cases.map((item) => item.expected.decision));
  assert.ok(decisions.has(Decision.AUTO_REPLY));
  assert.ok(decisions.has(Decision.ASK_FOR_MORE_INFORMATION));
  assert.ok(decisions.has(Decision.HUMAN_ESCALATION));
  assert.ok(decisions.has(Decision.OUT_OF_SCOPE));
});

test('deterministic scoring passes a matching grounded case', () => {
  const spec = dataset.cases.find((item) => item.id === 'availability-in-stock-de');
  assert.ok(spec);
  const evaluated = evaluateCase(spec, passingResult());
  assert.equal(evaluated.passed, true);
  assert.ok(evaluated.checks.every((item) => item.passed));
});

test('deterministic scoring exposes decision and grounding regressions', () => {
  const spec = dataset.cases.find((item) => item.id === 'availability-in-stock-de');
  assert.ok(spec);
  const result = passingResult();
  result.decision.decision = Decision.HUMAN_ESCALATION;
  result.response.delivered = false;
  result.response.draft = null;
  result.response.citedEvidence = [];
  result.audit.compliance.groundingStatus = 'not_applicable';

  const evaluated = evaluateCase(spec, result);
  assert.equal(evaluated.passed, false);
  const failures = evaluated.checks.filter((item) => !item.passed).map((item) => item.name);
  assert.ok(failures.includes('decision_exact'));
  assert.ok(failures.includes('grounding_verified'));
  assert.ok(failures.includes('safe_escalation'));
});

test('aggregate report includes quality, cost, latency and manual-review sections', () => {
  const spec = dataset.cases.find((item) => item.id === 'availability-in-stock-de');
  assert.ok(spec);
  const report = buildReport(dataset, [evaluateCase(spec, passingResult())], 'test', 'test-model');
  const markdown = renderMarkdown(report);
  assert.equal(report.aggregate.passRate, 1);
  assert.equal(report.aggregate.llm.calls, 3);
  assert.match(markdown, /Quality and Safety Metrics/);
  assert.match(markdown, /Cost and Latency/);
  assert.match(markdown, /Manual Review Checklist/);
  assert.match(markdown, /Limitations/);
});
