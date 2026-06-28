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
  /** Optional human-readable explanation of the outcome. */
  details: z.string().optional(),
});
