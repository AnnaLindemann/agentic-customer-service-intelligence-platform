import { z } from 'zod';
import { DECISIONS, INTENTS, REASON_CODES, RISK_LEVELS, WORKFLOWS } from '../domain';
import { RetrievedSourceSchema, StructuredSourceSchema } from './retrieval.schema';
import { EvaluationSummarySchema } from './evaluation.schema';
import { AuditTraceSchema } from './audit.schema';

/**
 * The Structured JSON Output: the single public response returned for a processed
 * email. It always carries the decision, its justification, the grounding evidence
 * and the full audit trace. `draft` is present for an auto-reply or a request for
 * more information, and null on human escalation.
 */
export const FinalApiResponseSchema = z.object({
  caseId: z.string(),
  decision: z.enum(DECISIONS),
  intent: z.enum(INTENTS),
  workflow: z.enum(WORKFLOWS),
  riskLevel: z.enum(RISK_LEVELS),
  reasonCode: z.enum(REASON_CODES),
  /** The drafted reply, or null when the case was escalated to a human. */
  draft: z.string().nullable(),
  /** Grounding evidence, separated by source type. */
  evidence: z.object({
    structured: z.array(StructuredSourceSchema).default([]),
    policies: z.array(RetrievedSourceSchema).default([]),
  }),
  evaluation: EvaluationSummarySchema,
  audit: AuditTraceSchema,
});
