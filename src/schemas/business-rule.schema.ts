import { z } from 'zod';
import { REASON_CODES, RISK_LEVELS } from '../domain';

/**
 * Result of applying a single deterministic business rule to the case. The Business
 * Rule Engine produces one of these per rule evaluated.
 */
export const BusinessRuleResultSchema = z.object({
  /** Stable identifier of the rule that ran, e.g. `cancellation.within_window`. */
  ruleId: z.string(),
  passed: z.boolean(),
  riskLevel: z.enum(RISK_LEVELS),
  reasonCode: z.enum(REASON_CODES),
  /**
   * How the Decision Gate must treat a *failed* rule (ADR-014, "Human by Exception v2"):
   *   - `blocking`      — a genuine policy conflict; a failure routes the case to a human.
   *   - `informational` — eligibility that shapes *which* grounded reply is sent, never a human
   *                       handoff (e.g. an order past its cancellation window is explained, not
   *                       escalated).
   * Optional for backward compatibility; absent is treated as `informational`.
   */
  kind: z.enum(['blocking', 'informational']).optional(),
  /** Optional human-readable explanation of the outcome. */
  details: z.string().optional(),
});
