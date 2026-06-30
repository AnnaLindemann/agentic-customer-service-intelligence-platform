import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { z } from 'zod';
import { Decision, Intent, ReasonCode, RiskLevel, Workflow } from '../domain';
import { LlmError, type LlmClient, type LlmJsonRequest } from '../llm';
import { classifyIntent, extractSlots } from '../pipeline/interpretation';
import {
  RESPONSE_PROMPT_VERSION,
  isLikelyGerman,
  prepareResponseEvidence,
  runResponseGeneration,
  validateCompliance,
} from '../pipeline/response';
import { config } from '../config/env';

function resultClient(payload: unknown, onCall?: () => void): LlmClient {
  return {
    model: 'test-model',
    async generateJson<T>(_request: LlmJsonRequest, schema: z.ZodType<T>) {
      onCall?.();
      return { data: schema.parse(payload), model: 'test-model', usage: null };
    },
  };
}

function failingClient(): LlmClient {
  return {
    model: 'test-model',
    async generateJson() {
      throw new LlmError('request failed', 'transport');
    },
  };
}

test('classifyIntent returns validated success and safe fallback', async () => {
  const success = await classifyIntent(
    { sanitizedEmail: 'Bitte stornieren Sie [ORDER_ID_1].' },
    resultClient({
      intent: Intent.CANCELLATION_REQUEST,
      confidence: 0.91,
      ranked: [{ intent: Intent.CANCELLATION_REQUEST, confidence: 0.91 }],
    }),
  );
  assert.equal(success.classification.intent, Intent.CANCELLATION_REQUEST);
  assert.equal(success.fallback, false);

  const fallback = await classifyIntent({ sanitizedEmail: 'Hallo' }, failingClient());
  assert.equal(fallback.classification.intent, Intent.UNKNOWN);
  assert.equal(fallback.fallback, true);
});

test('extractSlots returns validated success and safe fallback', async () => {
  const success = await extractSlots(
    { sanitizedEmail: 'Bestellung [ORDER_ID_1]' },
    resultClient({ slots: { orderId: '[ORDER_ID_1]' }, missing: [] }),
  );
  assert.equal(success.extraction.slots.orderId, '[ORDER_ID_1]');
  assert.equal(success.fallback, false);

  const fallback = await extractSlots({ sanitizedEmail: 'Hallo' }, failingClient());
  assert.deepEqual(fallback.extraction.slots, {});
  assert.equal(fallback.fallback, true);
});

test('unmasked input fails closed before an injected LLM is called', async () => {
  let calls = 0;
  const result = await classifyIntent(
    { sanitizedEmail: 'Kontakt: raw@example.com' },
    resultClient({}, () => calls++),
  );
  assert.equal(result.fallback, true);
  assert.equal(calls, 0);
});

test('client construction failures produce interpretation fallbacks', async () => {
  const previousKey = config.llm.apiKey;
  config.llm.apiKey = undefined;
  try {
    const intent = await classifyIntent({ sanitizedEmail: 'Hallo, bitte helfen Sie mir.' });
    const slots = await extractSlots({ sanitizedEmail: 'Hallo, bitte helfen Sie mir.' });
    assert.equal(intent.fallback, true);
    assert.equal(intent.classification.intent, Intent.UNKNOWN);
    assert.equal(slots.fallback, true);
    assert.deepEqual(slots.extraction.slots, {});
  } finally {
    config.llm.apiKey = previousKey;
  }
});

test('HUMAN_ESCALATION returns without constructing a configured client', async () => {
  const previousKey = config.llm.apiKey;
  config.llm.apiKey = undefined;
  try {
    const decision = {
      decision: Decision.HUMAN_ESCALATION,
      riskLevel: RiskLevel.HIGH,
      reasonCode: ReasonCode.ESCALATION_REQUIRED,
    };
    const result = await runResponseGeneration({
      decision,
      intent: Intent.UNKNOWN,
      workflow: Workflow.UNSUPPORTED,
      sanitizedEmail: '',
      missingInformation: [],
      structuredFacts: [],
      policyEvidence: [],
    });
    assert.equal(result.delivered, false);
    assert.equal(result.generationMode, 'NONE');
    assert.equal(result.promptVersion, RESPONSE_PROMPT_VERSION);
    assert.deepEqual(result.decision, decision);
  } finally {
    config.llm.apiKey = previousKey;
  }
});

test('compliance rejects evidence-free drafts and unsupported promises', () => {
  const evidenceFree = validateCompliance({
    decision: Decision.AUTO_REPLY,
    draft: 'Guten Tag, wir haben Ihre Anfrage geprüft und antworten Ihnen gern.',
    citedRefs: [],
    structuredFacts: [],
    policyEvidence: [],
    piiValues: [],
  });
  assert.equal(evidenceFree.passed, false);

  const unsupportedPromise = validateCompliance({
    decision: Decision.AUTO_REPLY,
    draft: 'Guten Tag, wir erstatten Ihnen den Betrag und danken Ihnen.',
    citedRefs: ['structured:product:1'],
    structuredFacts: [{ ref: 'structured:product:1', kind: 'product', data: { availability: 'in_stock' } }],
    policyEvidence: [],
    piiValues: [],
  });
  assert.equal(unsupportedPromise.passed, false);
  assert.equal(
    unsupportedPromise.checks.find((item) => item.name === 'no_unsupported_promises')?.passed,
    false,
  );
});

test('response evidence uses aliases and whitelists PII-bearing facts', () => {
  const prepared = prepareResponseEvidence(
    [{
      ref: 'customer:anna@example.com',
      kind: 'customer',
      data: { customerEmail: 'anna@example.com', customerName: 'Anna Schmidt', orderIds: ['10293'] },
    }],
    [],
  );
  const serialized = JSON.stringify(prepared);
  assert.doesNotMatch(serialized, /anna@example\.com|Anna Schmidt|10293/);
  assert.equal(prepared.structuredFacts[0].ref, 'structured:customer:1');
});

test('German validation is conservative', () => {
  assert.equal(isLikelyGerman('Guten Tag, bitte teilen Sie uns Ihre Bestellnummer mit.'), true);
  assert.equal(isLikelyGerman('Hello, your product is available and ready to ship.'), false);
  assert.equal(isLikelyGerman('Danke.'), false);
});

test('LLM success is the delivered canonical response and preserves the deterministic decision', async () => {
  const decision = {
    decision: Decision.AUTO_REPLY,
    riskLevel: RiskLevel.LOW,
    reasonCode: ReasonCode.AUTO_REPLY_ALLOWED,
  };
  const result = await runResponseGeneration(
    {
      decision,
      intent: Intent.PRODUCT_AVAILABILITY,
      workflow: Workflow.PRODUCT_AVAILABILITY,
      sanitizedEmail: 'Ist das Produkt verfügbar?',
      missingInformation: [],
      structuredFacts: [{
        ref: 'product:SKU-TENT-2P',
        kind: 'product',
        data: { name: 'Zelt', availability: 'in_stock', customerEmail: 'hidden@example.com' },
      }],
      policyEvidence: [],
    },
    resultClient({
      reply: 'Guten Tag, das Produkt ist verfügbar und wir teilen Ihnen dies gern mit.',
      citedRefs: ['structured:product:1'],
    }),
  );

  assert.equal(result.delivered, true);
  assert.equal(result.generationMode, 'LLM');
  assert.deepEqual(result.decision, decision);
  assert.equal(result.promptVersion, RESPONSE_PROMPT_VERSION);
  assert.deepEqual(result.citedEvidence, [{ ref: 'structured:product:1', source: 'structured' }]);
});

test('LLM failure delivers a compliant deterministic fallback canonically', async () => {
  const decision = {
    decision: Decision.AUTO_REPLY,
    riskLevel: RiskLevel.LOW,
    reasonCode: ReasonCode.AUTO_REPLY_ALLOWED,
  };
  const result = await runResponseGeneration(
    {
      decision,
      intent: Intent.PRODUCT_AVAILABILITY,
      workflow: Workflow.PRODUCT_AVAILABILITY,
      sanitizedEmail: 'Ist das Produkt verfügbar?',
      missingInformation: [],
      structuredFacts: [{
        ref: 'product:SKU-TENT-2P',
        kind: 'product',
        data: { name: 'Zelt', availability: 'in_stock' },
      }],
      policyEvidence: [],
      deterministicFallbackDraft:
        'Guten Tag,\n\nvielen Dank für Ihre Nachricht.\n\nDas Produkt ist verfügbar und kann bestellt werden.\n\nFreundliche Grüße\nIhr Kundenservice',
    },
    failingClient(),
  );

  assert.equal(result.generationMode, 'DETERMINISTIC_FALLBACK');
  assert.equal(result.delivered, true);
  assert.ok(result.draft?.includes('Produkt ist verfügbar'));
  assert.equal(result.compliance.passed, true);
  assert.deepEqual(result.decision, decision);
  assert.deepEqual(result.citedEvidence, [
    { ref: 'structured:product:1', source: 'structured' },
  ]);
});

test('LLM failure does not deliver a deterministic fallback that fails compliance', async () => {
  const decision = {
    decision: Decision.AUTO_REPLY,
    riskLevel: RiskLevel.LOW,
    reasonCode: ReasonCode.AUTO_REPLY_ALLOWED,
  };
  const result = await runResponseGeneration(
    {
      decision,
      intent: Intent.PRODUCT_AVAILABILITY,
      workflow: Workflow.PRODUCT_AVAILABILITY,
      sanitizedEmail: 'Ist das Produkt verfügbar?',
      missingInformation: [],
      structuredFacts: [{
        ref: 'product:SKU-TENT-2P',
        kind: 'product',
        data: { name: 'Zelt', availability: 'in_stock' },
      }],
      policyEvidence: [],
      deterministicFallbackDraft:
        'Guten Tag, wir erstatten Ihnen den Betrag und garantieren kostenlosen Ersatz.',
    },
    failingClient(),
  );

  assert.equal(result.generationMode, 'DETERMINISTIC_FALLBACK');
  assert.equal(result.delivered, false);
  assert.equal(result.draft, null);
  assert.equal(result.compliance.passed, false);
  assert.deepEqual(result.decision, decision);
  assert.doesNotMatch(
    result.compliance.checks.map((check) => check.detail ?? '').join(' '),
    /human handling|human escalation/i,
  );
});

test('damaged-item operational promise is replaced by a compliant eligibility response', async () => {
  const decision = {
    decision: Decision.AUTO_REPLY,
    riskLevel: RiskLevel.LOW,
    reasonCode: ReasonCode.AUTO_REPLY_ALLOWED,
  };
  const result = await runResponseGeneration(
    {
      decision,
      intent: Intent.DAMAGED_ITEM,
      workflow: Workflow.DAMAGED_ITEM,
      sanitizedEmail: 'Der gelieferte Artikel ist beschädigt. Was soll ich tun?',
      missingInformation: [],
      structuredFacts: [{
        ref: 'order:10003',
        kind: 'order',
        data: { status: 'delivered', deliveredAt: '2026-06-24T15:00:00Z' },
      }],
      policyEvidence: [{
        ref: 'customer-service-policy.pdf#p2',
        snippet: 'Damage claims reported within 30 days are eligible for evidence review.',
        score: 0.9,
      }],
      ruleResults: [
        {
          ruleId: 'damaged_item.order_delivered',
          passed: true,
          riskLevel: RiskLevel.LOW,
          reasonCode: ReasonCode.RULE_PASSED,
          kind: 'informational',
        },
        {
          ruleId: 'damaged_item.within_claim_window',
          passed: true,
          riskLevel: RiskLevel.LOW,
          reasonCode: ReasonCode.RULE_PASSED,
          kind: 'blocking',
        },
      ],
      deterministicFallbackDraft:
        'Guten Tag,\n\nvielen Dank für Ihre Nachricht. Ihre Schadensmeldung erfüllt die Voraussetzungen für die weitere Prüfung.\n\nBitte senden Sie Fotos des Artikels und der Verpackung. Anschließend würden die Unterlagen geprüft. Dieser Prototyp führt keine Erstattung aus.\n\nFreundliche Grüße\nIhr Kundenservice',
    },
    resultClient({
      reply: 'Guten Tag, wir erstatten Ihnen den Betrag und senden einen kostenlosen Ersatz.',
      citedRefs: ['structured:order:1', 'policy:1'],
    }),
  );

  assert.equal(result.generationMode, 'DETERMINISTIC_FALLBACK');
  assert.equal(result.delivered, true);
  assert.equal(result.compliance.passed, true);
  assert.match(result.draft ?? '', /weitere Prüfung/);
  assert.doesNotMatch(result.draft ?? '', /wir erstatten|senden einen.*Ersatz/i);
});
