import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Intent, Workflow } from '../domain';
import {
  ScopeStatus,
  buildCaseState,
  enrichWorkflow,
  sanitizePII,
  validateScope,
} from '../pipeline/customer-email';

test('PII Sanitizer masks contact details and customer identifiers', () => {
  const result = sanitizePII(
    [
      'Mein Name ist Anna Schmidt.',
      'E-Mail: anna.schmidt@example.com',
      'Telefon: +49 30 12345678',
      'Bestellung 10293',
      'Rechnung INV-2026-0001',
      'Customer ID: CUST-7788',
      'Gewünschtes Datum: 29.06.2026',
    ].join('\n'),
  );

  assert.doesNotMatch(result.sanitizedEmail, /anna\.schmidt@example\.com/i);
  assert.doesNotMatch(result.sanitizedEmail, /\+49 30 12345678/);
  assert.doesNotMatch(result.sanitizedEmail, /10293/);
  assert.doesNotMatch(result.sanitizedEmail, /INV-2026-0001/);
  assert.doesNotMatch(result.sanitizedEmail, /CUST-7788/);
  assert.match(result.sanitizedEmail, /29\.06\.2026/);
  assert.match(result.sanitizedEmail, /\[NAME_1\]/);
  assert.deepEqual(
    new Set(result.detectedPII.map((item) => item.type)),
    new Set(['name', 'email', 'phone', 'order_id', 'invoice_id', 'customer_id']),
  );
  assert.equal(result.maskingLog.length, result.detectedPII.length);
});

test('Scope Validation distinguishes supported, unknown and out-of-scope intents', () => {
  assert.equal(validateScope(Intent.CANCELLATION_REQUEST).status, ScopeStatus.SUPPORTED);
  assert.equal(validateScope(Intent.UNKNOWN).status, ScopeStatus.UNKNOWN);
  assert.equal(validateScope(Intent.OUT_OF_SCOPE).status, ScopeStatus.OUT_OF_SCOPE);
});

test('Workflow Enrichment maps only supported intents to predefined workflows', () => {
  const supported = enrichWorkflow({
    intent: Intent.CANCELLATION_REQUEST,
    scope: validateScope(Intent.CANCELLATION_REQUEST),
    slots: {},
  });
  assert.equal(supported.workflow, Workflow.CANCELLATION);
  assert.deepEqual(supported.missingInformation, ['orderId']);

  const unknown = enrichWorkflow({
    intent: Intent.UNKNOWN,
    scope: validateScope(Intent.UNKNOWN),
    slots: { orderId: '10293' },
  });
  assert.equal(unknown.workflow, Workflow.UNSUPPORTED);
  assert.deepEqual(unknown.requiredSlots, []);
});

test('Case State Builder creates a normalized downstream state', () => {
  const sanitization = sanitizePII('E-Mail: anna@example.com, Bestellung 10293');
  const classification = {
    intent: Intent.CANCELLATION_REQUEST,
    confidence: 0.9,
    ranked: [{ intent: Intent.CANCELLATION_REQUEST, confidence: 0.9 }],
  };
  const scope = validateScope(classification.intent);
  const extraction = { slots: { orderId: '[ORDER_ID_1]' }, missing: [] };
  const enrichment = enrichWorkflow({ intent: classification.intent, scope, slots: extraction.slots });

  const state = buildCaseState({
    caseId: '  case-1  ',
    receivedAt: '2026-06-29T10:00:00.000Z',
    originalEmail: 'E-Mail: anna@example.com, Bestellung 10293',
    sanitization,
    classification,
    scope,
    extraction,
    enrichment,
  });

  assert.equal(state.caseId, 'case-1');
  assert.equal(state.sanitizedEmail, sanitization.sanitizedEmail);
  assert.equal(state.workflow, Workflow.CANCELLATION);
  assert.deepEqual(state.slots, { orderId: '[ORDER_ID_1]' });
  assert.deepEqual(state.structuredSources, []);
  assert.ok(state.reasonCodes.includes('PII_DETECTED'));
});
