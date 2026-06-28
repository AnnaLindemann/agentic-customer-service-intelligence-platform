import { z } from 'zod';
import { DECISIONS, REASON_CODES, RISK_LEVELS } from '../domain';

/**
 * Output contract for the Decision Gate: the action to take, with the risk level and
 * reason code that justify it.
 */
export const DecisionSchema = z.object({
  decision: z.enum(DECISIONS),
  riskLevel: z.enum(RISK_LEVELS),
  reasonCode: z.enum(REASON_CODES),
  /** Optional short explanation accompanying the decision. */
  rationale: z.string().optional(),
});
