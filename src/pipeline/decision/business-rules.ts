/**
 * Business Rule Engine — the pipeline stage.
 *
 * Responsibility: apply the company's deterministic business rules to the retrieved facts and
 * return one result per rule evaluated. This is where business judgement lives — "rules
 * decide" (ADR-001). It never calls an LLM and never invents data: every rule reads the
 * structured records that Retrieval already found and produces an explainable pass/fail with a
 * reason code, risk level and human-readable detail.
 *
 * The engine records *passed* rules too, not just failures, so the audit trail can reconstruct
 * exactly why an auto-reply was permitted (design principle 4). It does not pick the final
 * action — that is the Decision Gate's job; it only reports rule outcomes.
 *
 * Each result is validated against `BusinessRuleResultSchema` (the Phase 2 contract).
 *
 * NOTE: the concrete thresholds and status checks below (e.g. the 24h cancellation window,
 * "only delivered orders can be reported damaged") are reasonable defaults for the MVP, not
 * a published policy. They are isolated here so the project owner can adjust them on review.
 *
 * ADR-014 ("Human by Exception v2"): under v2 these eligibility rules are *informational*, not
 * *blocking*. A failed eligibility rule no longer routes the case to a human — it tells the
 * Decision Gate *which* grounded reply to send (e.g. confirm a cancellation vs. explain why it is
 * no longer possible and offer the return path). Only a rule explicitly marked `blocking` forces
 * escalation; none do today, but the field keeps the distinction explicit and future-proof. The
 * genuine human-only signals (disputes, chargebacks, goodwill, fraud, legal) are detected
 * separately by the Escalation-Trigger Guard.
 */
import {
  BusinessRuleResultSchema,
  InvoiceRecordSchema,
  OrderRecordSchema,
} from '../../schemas';
import { ReasonCode, RiskLevel, Workflow } from '../../domain';
import type {
  BusinessRuleResult,
  ExtractedSlots,
  StructuredSource,
} from '../../types';

/** Hours after an order is placed during which it may be auto-cancelled. */
export const CANCELLATION_WINDOW_HOURS = 24;

/** How the Decision Gate treats a failed rule. See `BusinessRuleResultSchema.kind`. */
type RuleKind = 'blocking' | 'informational';

export interface BusinessRuleInput {
  workflow: Workflow;
  /** Extracted slots (carried for rules that need the customer's stated values). */
  slots: ExtractedSlots;
  /** Structured business facts returned by Structured Data Retrieval. */
  structuredFacts: StructuredSource[];
  /** Evaluation time, injectable for deterministic testing. Defaults to now. */
  now?: Date;
}

/** Build a validated rule result, defaulting the reason code from the pass/fail outcome. */
function makeRule(
  ruleId: string,
  passed: boolean,
  riskLevel: RiskLevel,
  details: string,
  reasonCode?: ReasonCode,
  kind: RuleKind = 'informational',
): BusinessRuleResult {
  return BusinessRuleResultSchema.parse({
    ruleId,
    passed,
    riskLevel,
    kind,
    reasonCode: reasonCode ?? (passed ? ReasonCode.RULE_PASSED : ReasonCode.BUSINESS_RULE_CONFLICT),
    details,
  });
}

/** A rule result signalling the record a workflow needs was not retrieved. */
function recordMissing(ruleId: string, details: string): BusinessRuleResult {
  return makeRule(ruleId, false, RiskLevel.MEDIUM, details, ReasonCode.STRUCTURED_DATA_MISSING);
}

function findFact(facts: StructuredSource[], kind: StructuredSource['kind']) {
  return facts.find((fact) => fact.kind === kind);
}

/**
 * Apply the rules for the case's workflow. Returns an empty list for the `unsupported`
 * workflow (no rules apply — the Decision Gate escalates on scope, not on rules).
 */
export function applyBusinessRules(input: BusinessRuleInput): BusinessRuleResult[] {
  const now = input.now ?? new Date();
  switch (input.workflow) {
    case Workflow.CANCELLATION:
      return cancellationRules(input.structuredFacts, now);
    case Workflow.DAMAGED_ITEM:
      return damagedItemRules(input.structuredFacts);
    case Workflow.INVOICE:
      return invoiceRules(input.structuredFacts);
    case Workflow.PRODUCT_AVAILABILITY:
      return productAvailabilityRules(input.structuredFacts);
    case Workflow.UNSUPPORTED:
    default:
      return [];
  }
}

/** An order may be auto-cancelled only while still processing and within the time window. */
function cancellationRules(facts: StructuredSource[], now: Date): BusinessRuleResult[] {
  const fact = findFact(facts, 'order');
  if (!fact) {
    return [recordMissing('cancellation.order_present', 'No order record was retrieved to evaluate.')];
  }
  const parsed = OrderRecordSchema.safeParse(fact.data);
  if (!parsed.success) {
    return [recordMissing('cancellation.order_present', 'Retrieved order record is malformed.')];
  }
  const order = parsed.data;

  const notShipped = order.status === 'processing';
  const hoursSince = (now.getTime() - new Date(order.placedAt).getTime()) / 3_600_000;
  const withinWindow = hoursSince <= CANCELLATION_WINDOW_HOURS;

  return [
    makeRule(
      'cancellation.not_yet_shipped',
      notShipped,
      notShipped ? RiskLevel.LOW : RiskLevel.MEDIUM,
      notShipped
        ? `Order ${order.orderId} is still processing and has not shipped.`
        : `Order ${order.orderId} status is '${order.status}'; it can no longer be auto-cancelled.`,
    ),
    makeRule(
      'cancellation.within_window',
      withinWindow,
      RiskLevel.LOW,
      withinWindow
        ? `Order ${order.orderId} was placed ${hoursSince.toFixed(1)}h ago, within the ${CANCELLATION_WINDOW_HOURS}h cancellation window.`
        : `Order ${order.orderId} was placed ${hoursSince.toFixed(1)}h ago, past the ${CANCELLATION_WINDOW_HOURS}h cancellation window.`,
    ),
  ];
}

/** A damage report can be processed only once the order has been delivered. */
function damagedItemRules(facts: StructuredSource[]): BusinessRuleResult[] {
  const fact = findFact(facts, 'order');
  if (!fact) {
    return [recordMissing('damaged_item.order_present', 'No order record was retrieved to evaluate.')];
  }
  const parsed = OrderRecordSchema.safeParse(fact.data);
  if (!parsed.success) {
    return [recordMissing('damaged_item.order_present', 'Retrieved order record is malformed.')];
  }
  const order = parsed.data;

  const delivered = order.status === 'delivered';
  return [
    makeRule(
      'damaged_item.order_delivered',
      delivered,
      delivered ? RiskLevel.LOW : RiskLevel.MEDIUM,
      delivered
        ? `Order ${order.orderId} is delivered; a damage report can be processed.`
        : `Order ${order.orderId} status is '${order.status}'; delivery cannot be confirmed for a damage claim.`,
    ),
  ];
}

/**
 * Invoice questions are informational: any located invoice can be answered from the billing record,
 * whatever its status (ADR-014). A refunded or voided invoice is *explained* from data, not
 * escalated; genuine money disputes/chargebacks are caught separately by the Escalation-Trigger
 * Guard. The rule therefore always passes and carries the status as context for the reply.
 */
function invoiceRules(facts: StructuredSource[]): BusinessRuleResult[] {
  const fact = findFact(facts, 'invoice');
  if (!fact) {
    return [recordMissing('invoice.invoice_present', 'No invoice record was retrieved to evaluate.')];
  }
  const parsed = InvoiceRecordSchema.safeParse(fact.data);
  if (!parsed.success) {
    return [recordMissing('invoice.invoice_present', 'Retrieved invoice record is malformed.')];
  }
  const invoice = parsed.data;

  return [
    makeRule(
      'invoice.answerable',
      true,
      RiskLevel.LOW,
      `Invoice ${invoice.invoiceId} is '${invoice.status}'; the question is answered from the billing record.`,
    ),
  ];
}

/** Availability questions are always answerable once the product is found in the catalogue. */
function productAvailabilityRules(facts: StructuredSource[]): BusinessRuleResult[] {
  const fact = findFact(facts, 'product');
  if (!fact) {
    return [recordMissing('product_availability.product_present', 'No product record was retrieved to evaluate.')];
  }
  const name = typeof fact.data.name === 'string' ? fact.data.name : fact.ref;
  const availability = typeof fact.data.availability === 'string' ? fact.data.availability : 'unknown';
  return [
    makeRule(
      'product_availability.answerable',
      true,
      RiskLevel.LOW,
      `Product '${name}' is in the catalogue (availability: ${availability}); the question can be answered from inventory data.`,
    ),
  ];
}
