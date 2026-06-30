import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { Decision, Intent, ReasonCode, RiskLevel, Workflow } from '../domain';
import { LlmError, type LlmClient, type LlmJsonRequest, type LlmJsonResult } from '../llm';
import {
  buildAuditTrace,
  createLlmCallRecorder,
  estimateCostUsd,
  instrumentLlmClient,
  type BuildAuditTraceInput,
} from '../pipeline/audit';
import { AuditRecordSchema } from '../schemas';
import type {
  DecisionEngineResult,
  GeneratedResponse,
  IntentClassification,
  SlotExtraction,
} from '../types';

// A secret prompt/completion/PII string we assert never appears anywhere in the audit output.
const SECRET_PROMPT = 'SECRET-SYSTEM-PROMPT-do-not-store-12345';
const SECRET_USER = 'SECRET-USER-EMAIL-body-do-not-store';
const SECRET_REPLY = 'SECRET-COMPLETION-REPLY-do-not-store';
const RAW_PII = 'max.mustermann@secret-domain.example';

/** A fake provider-boundary client returning a fixed result + passive call metadata. */
function fakeClient(
  payload: unknown,
  opts: {
    model?: string;
    latencyMs?: number;
    retryCount?: number;
    providerRequestId?: string | null;
    usage?: { inputTokens: number; outputTokens: number } | null;
  } = {},
): LlmClient {
  const model = opts.model ?? 'openai/gpt-oss-120b';
  return {
    model,
    async generateJson<T>(_req: LlmJsonRequest, schema: z.ZodType<T>): Promise<LlmJsonResult<T>> {
      return {
        data: schema.parse(payload),
        model,
        usage: opts.usage ?? { inputTokens: 1000, outputTokens: 500 },
        meta: {
          latencyMs: opts.latencyMs ?? 1234,
          retryCount: opts.retryCount ?? 0,
          providerRequestId: opts.providerRequestId ?? 'req_abc123',
          jsonValidationResult: 'valid',
        },
      };
    },
  };
}

function sampleClassification(): IntentClassification {
  return {
    intent: Intent.PRODUCT_AVAILABILITY,
    confidence: 0.92,
    ranked: [
      { intent: Intent.PRODUCT_AVAILABILITY, confidence: 0.92 },
      { intent: Intent.INVOICE_QUESTION, confidence: 0.05 },
    ],
  };
}

function sampleSlots(): SlotExtraction {
  // A raw-PII-looking value is placed in a slot value on purpose: the audit must record only
  // the slot *keys*, never the values.
  return { slots: { productName: 'Nordlicht-Lampe', customerEmail: RAW_PII }, missing: ['orderId'] };
}

function sampleDecisionEngine(decision: Decision = Decision.AUTO_REPLY): DecisionEngineResult {
  return {
    evaluation: {
      sufficient: true,
      reasonCode: ReasonCode.DATA_SUFFICIENT,
      missingInformation: [],
      hasStructuredData: true,
      hasPolicyEvidence: true,
    },
    ruleResults: [
      {
        ruleId: 'product_availability.in_stock',
        passed: true,
        riskLevel: RiskLevel.LOW,
        reasonCode: ReasonCode.RULE_PASSED,
      },
    ],
    decision: {
      decision,
      riskLevel: RiskLevel.LOW,
      reasonCode:
        decision === Decision.AUTO_REPLY
          ? ReasonCode.AUTO_REPLY_ALLOWED
          : ReasonCode.ESCALATION_REQUIRED,
      rationale: 'sample',
    },
  };
}

function sampleResponse(delivered = true): GeneratedResponse {
  return {
    language: 'de',
    promptVersion: 'response-generation/v2',
    generationMode: delivered ? 'LLM' : 'NONE',
    decision: sampleDecisionEngine().decision,
    draft: delivered ? 'Guten Tag, das Produkt ist verfügbar.' : null,
    delivered,
    citedEvidence: delivered ? [{ ref: 'policy:1', source: 'policy' }] : [],
    compliance: {
      passed: delivered,
      checks: [
        { name: 'grounded_citations', passed: delivered },
        { name: 'no_unsupported_promises', passed: true },
        { name: 'no_pii_leakage', passed: true },
        { name: 'language_match', passed: true },
        { name: 'matches_decision', passed: delivered },
      ],
    },
  };
}

function baseInput(overrides: Partial<BuildAuditTraceInput> = {}): BuildAuditTraceInput {
  return {
    caseId: 'case-1',
    now: new Date('2026-06-29T10:00:00.000Z'),
    classification: sampleClassification(),
    slots: sampleSlots(),
    workflow: Workflow.PRODUCT_AVAILABILITY,
    decisionEngine: sampleDecisionEngine(),
    response: sampleResponse(),
    ...overrides,
  };
}

test('audit trace creation produces a provider-neutral, schema-valid record', async () => {
  const recorder = createLlmCallRecorder();
  const client = instrumentLlmClient(fakeClient({ ok: true }), recorder, { provider: 'groq' });
  await client.generateJson(
    { system: SECRET_PROMPT, user: SECRET_USER, schemaName: 'IntentClassification@intent-classification/v1' },
    z.object({ ok: z.literal(true) }),
  );

  const record = buildAuditTrace(baseInput({ llm: recorder.entries() }));

  // Re-validating proves the shape is exactly the published contract.
  assert.doesNotThrow(() => AuditRecordSchema.parse(record));
  assert.equal(record.caseId, 'case-1');
  assert.equal(record.execution.pipelineVersion, 'mvp/v1');
  assert.ok(record.execution.executionId.length > 0);
  assert.ok(record.execution.traceId.length > 0);
  assert.equal(record.llm.length, 1);
  assert.equal(record.llm[0]!.provider, 'groq');
});

test('no raw prompt, completion or PII is stored anywhere in the audit record', async () => {
  const recorder = createLlmCallRecorder();
  
  const client = instrumentLlmClient(
    fakeClient({ reply: SECRET_REPLY }),
    recorder,
    { provider: 'groq' },
  );
  await client.generateJson(
    { system: SECRET_PROMPT, user: SECRET_USER, schemaName: 'LlmDraft@response-generation/v1' },
    z.object({ reply: z.string() }),
  );

  const record = buildAuditTrace(baseInput({ llm: recorder.entries() }));
  const serialized = JSON.stringify(record);

  assert.doesNotMatch(serialized, new RegExp(SECRET_PROMPT));
  assert.doesNotMatch(serialized, new RegExp(SECRET_USER));
  assert.doesNotMatch(serialized, new RegExp(SECRET_REPLY));
  // Raw PII placed in a slot value must not leak: only slot keys are recorded.
  assert.doesNotMatch(serialized, /max\.mustermann@secret-domain\.example/);
  assert.deepEqual(record.decision.extractedSlots.present.sort(), ['customerEmail', 'productName']);
  // A non-reversible fingerprint is recorded instead of the prompt text.
  assert.ok(record.llm[0]!.promptFingerprint && record.llm[0]!.promptFingerprint.length === 16);
});

test('cost calculation for a known model', () => {
  // 1000 in @ $0.15/M + 500 out @ $0.75/M = 0.00015 + 0.000375 = 0.000525
  assert.equal(estimateCostUsd('openai/gpt-oss-120b', 1000, 500), 0.000525);
  assert.equal(estimateCostUsd('openai/gpt-oss-20b', 1000, 500), 0.00035);
});

test('unknown model cost returns null (never throws)', () => {
  assert.equal(estimateCostUsd('anthropic/claude-future', 1000, 500), null);
  assert.equal(estimateCostUsd(null, 1000, 500), null);
  // Known model but missing token counts is also null, not an error.
  assert.equal(estimateCostUsd('openai/gpt-oss-120b', null, 500), null);
});

test('retry count and latency are recorded from provider metadata', async () => {
  const recorder = createLlmCallRecorder();
  
  const client = instrumentLlmClient(
    fakeClient({ ok: true }, { retryCount: 1, latencyMs: 4242 }),
    recorder,
    { provider: 'groq' },
  );
  await client.generateJson(
    { system: 's', user: 'u', schemaName: 'IntentClassification@intent-classification/v1' },
    z.object({ ok: z.literal(true) }),
  );

  const entry = recorder.entries()[0]!;
  assert.equal(entry.retryCount, 1);
  assert.equal(entry.latencyMs, 4242);
  assert.equal(entry.estimatedCostUsd, 0.000525);
  assert.equal(entry.totalTokens, 1500);

  const record = buildAuditTrace(baseInput({ llm: recorder.entries() }));
  assert.equal(record.llmTotals.retryCount, 1);
  assert.equal(record.llmTotals.latencyMs, 4242);
  assert.equal(record.llmTotals.callCount, 1);
});

test('a failed LLM call is recorded with its error kind and no leaked body', async () => {
  const recorder = createLlmCallRecorder();
  
  const failing: LlmClient = {
    model: 'openai/gpt-oss-120b',
    async generateJson() {
      throw new LlmError('generic failure', 'invalid_output', {
        meta: {
          latencyMs: 99,
          retryCount: 1,
          providerRequestId: null,
          jsonValidationResult: 'schema_invalid',
        },
      });
    },
  };
  const client = instrumentLlmClient(failing, recorder, { provider: 'groq' });

  await assert.rejects(() =>
    client.generateJson(
      { system: SECRET_PROMPT, user: SECRET_USER, schemaName: 'SlotExtraction@slot-extraction/v1' },
      z.object({ ok: z.literal(true) }),
    ),
  );

  const entry = recorder.entries()[0]!;
  assert.equal(entry.errorKind, 'invalid_output');
  assert.equal(entry.jsonValidationResult, 'schema_invalid');
  assert.equal(entry.retryCount, 1);
  assert.equal(entry.estimatedCostUsd, null);
  assert.doesNotMatch(JSON.stringify(entry), new RegExp(SECRET_PROMPT));
});

test('decision metadata is preserved exactly', () => {
  const record = buildAuditTrace(baseInput());
  assert.equal(record.decision.intent, Intent.PRODUCT_AVAILABILITY);
  assert.equal(record.decision.workflow, Workflow.PRODUCT_AVAILABILITY);
  assert.equal(record.decision.scopeStatus, 'in_scope');
  assert.equal(record.decision.finalDecision, Decision.AUTO_REPLY);
  assert.equal(record.decision.finalOutcome, 'auto_replied');
  assert.equal(record.decision.businessRules.total, 1);
  assert.equal(record.decision.businessRules.passed, 1);
  assert.equal(record.decision.rankedIntents.length, 2);
  assert.ok(record.decision.reasonCodes.includes(ReasonCode.AUTO_REPLY_ALLOWED));
  assert.ok(record.decision.reasonCodes.includes(ReasonCode.DATA_SUFFICIENT));
  assert.equal(record.compliance.compliancePassed, true);
  assert.equal(record.compliance.generationMode, 'LLM');
  assert.equal(record.compliance.citedEvidenceCount, 1);
  assert.equal(record.compliance.groundingStatus, 'grounded');
});

test('audit does not mutate any input object (decision, classification, slots, response)', () => {
  const input = baseInput();
  const decisionEngineBefore = structuredClone(input.decisionEngine);
  const decisionBefore = structuredClone(input.decisionEngine.decision);
  const classificationBefore = structuredClone(input.classification);
  const slotsBefore = structuredClone(input.slots);
  const responseBefore = structuredClone(input.response);

  const record = buildAuditTrace(input);

  // Every input is byte-for-byte unchanged: audit is purely observational.
  assert.deepEqual(input.decisionEngine, decisionEngineBefore);
  assert.deepEqual(input.decisionEngine.decision, decisionBefore);
  assert.deepEqual(input.classification, classificationBefore);
  assert.deepEqual(input.slots, slotsBefore);
  assert.deepEqual(input.response, responseBefore);

  // The Decision object specifically is copied through unchanged, never re-derived.
  assert.deepEqual(record.decision.finalDecision, input.decisionEngine.decision.decision);

  // The output owns its own arrays — it does not alias the input's, so a later consumer
  // mutating the record cannot reach back into pipeline state.
  assert.notEqual(record.decision.rankedIntents, input.classification.ranked);
  assert.notEqual(record.decision.dataSufficiency, input.decisionEngine.evaluation);
});

test('escalation produces a safe, well-formed record with no response', () => {
  const record = buildAuditTrace(
    baseInput({
      workflow: Workflow.UNSUPPORTED,
      classification: { intent: Intent.UNKNOWN, confidence: 0, ranked: [{ intent: Intent.UNKNOWN, confidence: 0 }] },
      decisionEngine: sampleDecisionEngine(Decision.HUMAN_ESCALATION),
      response: undefined,
    }),
  );
  assert.equal(record.decision.finalOutcome, 'escalated');
  assert.equal(record.decision.scopeStatus, 'out_of_scope');
  assert.equal(record.compliance.groundingStatus, 'not_applicable');
  assert.equal(record.evaluation.hallucinationRisk, 'low');
  assert.doesNotThrow(() => AuditRecordSchema.parse(record));
});

test('the provider-neutral schema shape is identical across providers', async () => {
  
  const make = async (provider: string) => {
    const recorder = createLlmCallRecorder();
    const client = instrumentLlmClient(fakeClient({ ok: true }), recorder, { provider });
    await client.generateJson(
      { system: 's', user: 'u', schemaName: 'IntentClassification@intent-classification/v1' },
      z.object({ ok: z.literal(true) }),
    );
    return recorder.entries()[0]!;
  };
  const groq = await make('groq');
  const openai = await make('openai');
  assert.deepEqual(Object.keys(groq).sort(), Object.keys(openai).sort());
  assert.equal(groq.provider, 'groq');
  assert.equal(openai.provider, 'openai');
});

test('buildAuditTrace never throws on minimal input and missing metadata', () => {
  const record = buildAuditTrace({
    classification: { intent: Intent.UNKNOWN, confidence: 0, ranked: [{ intent: Intent.UNKNOWN, confidence: 0 }] },
    slots: { slots: {}, missing: [] },
    workflow: Workflow.UNSUPPORTED,
    decisionEngine: sampleDecisionEngine(Decision.HUMAN_ESCALATION),
    // no llm, no response, no ids, no timestamp
  });
  assert.equal(record.llm.length, 0);
  assert.equal(record.llmTotals.callCount, 0);
  assert.equal(record.llmTotals.estimatedCostUsd, 0);
  assert.ok(record.execution.executionId.length > 0);
});
