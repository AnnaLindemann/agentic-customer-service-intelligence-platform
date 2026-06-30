/**
 * Case Intake — deterministic simulated case references (ADR-014, "Human by Exception v2").
 *
 * When the platform automates an *action* or *intake* outcome it should behave like a Customer
 * Operations system, not an email router: it opens a tracked case and tells the customer the
 * reference. This module mints those references deterministically from the workflow and the
 * resolved order id, so the same email always yields the same reference (reproducible demos and
 * tests) and no LLM or external system is involved.
 *
 * The reference is a *simulated* artifact for the prototype — there is no backing ticketing
 * system. It is surfaced to the customer in the reply and recorded in the audit stage timeline.
 *
 * References by workflow:
 *   - cancellation → `CXL-<token>`  (cancellation confirmation or follow-up case)
 *   - damaged_item → `RMA-<token>`  (return / replacement case)
 * Other workflows (invoice questions, product availability) are informational and open no case.
 *
 * The `<token>` is a short, stable hash of the order id — **not** the order id itself. The order
 * id is treated as PII in this system (masked before any LLM call, and rejected by the response
 * compliance leak check). Deriving a non-reversible token keeps the reference safe to quote in the
 * customer reply while staying deterministic (the same order always yields the same reference) and
 * preserving the PII strategy unchanged.
 */
import { createHash } from 'node:crypto';
import { Workflow } from '../../domain';
import type { ExtractedSlots } from '../../types';

const PREFIX_BY_WORKFLOW: Partial<Record<Workflow, string>> = {
  [Workflow.CANCELLATION]: 'CXL',
  [Workflow.DAMAGED_ITEM]: 'RMA',
};

/** A short, stable, non-reversible token derived from the prefix and order id. */
function caseToken(prefix: string, orderId: string): string {
  return createHash('sha1').update(`${prefix}:${orderId}`).digest('hex').slice(0, 6).toUpperCase();
}

/**
 * Build a simulated case reference for an action/intake workflow, or `undefined` when the workflow
 * opens no case or the order id needed to anchor the reference is not available.
 */
export function buildCaseReference(
  workflow: Workflow,
  slots: ExtractedSlots,
): string | undefined {
  const prefix = PREFIX_BY_WORKFLOW[workflow];
  if (!prefix) return undefined;
  const orderId = slots.orderId?.trim();
  if (!orderId) return undefined;
  return `${prefix}-${caseToken(prefix, orderId)}`;
}
