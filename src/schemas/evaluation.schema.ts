import { z } from 'zod';
import { REASON_CODES } from '../domain';

/**
 * Summary produced by the Data Sufficiency Evaluation stage: whether enough evidence
 * exists to answer the case safely, and what (if anything) is missing.
 */
export const EvaluationSummarySchema = z.object({
  sufficient: z.boolean(),
  reasonCode: z.enum(REASON_CODES),
  /** Names of fields or evidence still required to proceed. */
  missingInformation: z.array(z.string()).default([]),
  hasStructuredData: z.boolean(),
  hasPolicyEvidence: z.boolean(),
});
