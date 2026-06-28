import { z } from 'zod';
import { REASON_CODES } from '../domain';

/** A single stage's contribution to the audit trail. */
export const AuditStageRecordSchema = z.object({
  /** Pipeline stage name, e.g. `DecisionGate`. */
  stage: z.string(),
  /** Short outcome label for the stage, e.g. `passed` or `escalate`. */
  result: z.string(),
  reasonCode: z.enum(REASON_CODES).optional(),
  /** ISO-8601 timestamp of when the stage ran. */
  at: z.string(),
});

/**
 * The ordered record of every stage, decision and reason code for a case, enabling a
 * human to reconstruct why an outcome occurred (design principle 4).
 */
export const AuditTraceSchema = z.object({
  caseId: z.string(),
  stages: z.array(AuditStageRecordSchema).default([]),
});
