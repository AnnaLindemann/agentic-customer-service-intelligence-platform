import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Decision, Intent, ReasonCode, Workflow } from '../domain';
import { buildAuditTrace } from '../pipeline/audit';
import { DAMAGED_ITEM_WINDOW_DAYS, runDecisionEngine } from '../pipeline/decision';
import type { StructuredSource } from '../types';

const NOW = new Date('2026-06-30T12:00:00.000Z');

function orderFact(orderId: string, deliveredAt: string): StructuredSource {
  return {
    ref: `order:${orderId}`,
    kind: 'order',
    data: {
      orderId,
      customerEmail: 'synthetic@example.com',
      customerName: 'Synthetic Customer',
      status: 'delivered',
      placedAt: '2026-04-10T09:00:00Z',
      shippedAt: '2026-04-11T10:30:00Z',
      deliveredAt,
      cancelledAt: null,
      returnedAt: null,
      shippingMethod: 'standard',
      shippingAddress: {
        line1: '1 Test Street',
        city: 'Test City',
        region: 'TS',
        postalCode: '00000',
        country: 'US',
      },
      items: [{ sku: 'SKU-BAG-20F', name: 'TrailRest 20F Sleeping Bag', quantity: 1, unitPrice: 129 }],
      currency: 'USD',
      subtotal: 129,
      shipping: 7.95,
      tax: 10.32,
      total: 147.27,
    },
  };
}

function decideDamageClaim(order: StructuredSource) {
  return runDecisionEngine({
    caseId: 'case-damage-window',
    workflow: Workflow.DAMAGED_ITEM,
    intent: Intent.DAMAGED_ITEM,
    slots: { orderId: String(order.data.orderId), reason: 'damaged item' },
    missingInformation: [],
    structuredFacts: [order],
    policyEvidence: [{ ref: 'customer-service-policy.pdf#p2', snippet: 'Damage claims must be reported within 30 days of delivery.', score: 0.9 }],
    rankedIntents: [{ intent: Intent.DAMAGED_ITEM, confidence: 0.95 }],
    now: NOW,
  });
}

test('damaged-item claim within 30 days follows the existing automated intake path', () => {
  const result = decideDamageClaim(orderFact('10003', '2026-06-24T15:00:00Z'));
  const windowRule = result.ruleResults.find((rule) => rule.ruleId === 'damaged_item.within_claim_window');

  assert.equal(DAMAGED_ITEM_WINDOW_DAYS, 30);
  assert.equal(windowRule?.passed, true);
  assert.equal(windowRule?.kind, 'blocking');
  assert.equal(result.decision.decision, Decision.AUTO_REPLY);
});

test('damaged-item claim older than 30 days takes the documented human exception path', () => {
  const result = decideDamageClaim(orderFact('10007', '2026-04-15T16:45:00Z'));
  const windowRule = result.ruleResults.find((rule) => rule.ruleId === 'damaged_item.within_claim_window');

  assert.equal(windowRule?.passed, false);
  assert.equal(windowRule?.kind, 'blocking');
  assert.equal(windowRule?.reasonCode, ReasonCode.DAMAGE_CLAIM_WINDOW_EXPIRED);
  assert.equal(result.decision.decision, Decision.HUMAN_ESCALATION);
  assert.equal(result.decision.reasonCode, ReasonCode.DAMAGE_CLAIM_WINDOW_EXPIRED);

  const audit = buildAuditTrace({
    caseId: 'case-damage-window',
    now: NOW,
    classification: {
      intent: Intent.DAMAGED_ITEM,
      confidence: 0.95,
      ranked: [{ intent: Intent.DAMAGED_ITEM, confidence: 0.95 }],
    },
    slots: { slots: { orderId: '[ORDER_ID_1]', reason: 'damaged item' }, missing: [] },
    workflow: Workflow.DAMAGED_ITEM,
    decisionEngine: result,
  });
  assert.equal(audit.decision.finalOutcome, 'escalated');
  assert.ok(audit.decision.reasonCodes.includes(ReasonCode.DAMAGE_CLAIM_WINDOW_EXPIRED));
});
