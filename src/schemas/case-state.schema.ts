import { z } from 'zod';
import { INTENTS, REASON_CODES, WORKFLOWS } from '../domain';
import { RankedIntentSchema } from './intent.schema';
import { ExtractedSlotsSchema } from './slots.schema';
import { DetectedPIISchema, MaskingLogEntrySchema } from './pii.schema';
import { StructuredSourceSchema, RetrievedSourceSchema } from './retrieval.schema';
import { EvaluationSummarySchema } from './evaluation.schema';
import { DecisionSchema } from './decision.schema';
import { AuditTraceSchema } from './audit.schema';

/**
 * The case object that flows through the whole pipeline. It is the single lifecycle
 * contract: created at ingestion with the raw email, then progressively enriched by
 * each stage (sanitization, classification, scope validation, slot extraction,
 * retrieval, evaluation, decisioning, audit).
 *
 * Only `caseId`, `receivedAt` and `originalEmail` are known at initialization. Every
 * downstream artifact is optional or defaulted so the same schema validates the case
 * at any point in its lifecycle, without excluding later-stage data.
 */
export const CaseStateSchema = z.object({
  caseId: z.string(),
  /** ISO-8601 timestamp of when the email entered the pipeline. */
  receivedAt: z.string(),

  // --- Ingestion ---
  /** The raw inbound email body, as received. */
  originalEmail: z.string(),
  /** Email body after PII masking — the only form passed to LLM stages. */
  sanitizedEmail: z.string().optional(),
  detectedPii: z.array(DetectedPIISchema).default([]),
  maskingLog: z.array(MaskingLogEntrySchema).default([]),

  // --- Classification & scope ---
  intent: z.enum(INTENTS).optional(),
  rankedIntents: z.array(RankedIntentSchema).default([]),
  workflow: z.enum(WORKFLOWS).optional(),

  // --- Slot extraction & enrichment ---
  slots: ExtractedSlotsSchema.optional(),
  /** Required slots that workflow enrichment found to be missing. */
  missingInformation: z.array(z.string()).default([]),

  // --- Retrieval ---
  structuredSources: z.array(StructuredSourceSchema).default([]),
  pdfSources: z.array(RetrievedSourceSchema).default([]),

  // --- Evaluation & decision ---
  evaluation: EvaluationSummarySchema.optional(),
  decision: DecisionSchema.optional(),
  /** Reason codes accumulated across stages, in order, for explainability. */
  reasonCodes: z.array(z.enum(REASON_CODES)).default([]),

  // --- Audit ---
  auditTrace: AuditTraceSchema.optional(),
});
