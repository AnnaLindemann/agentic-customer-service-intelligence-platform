/**
 * Core domain types.
 *
 * Every type here is inferred from its Zod schema in `src/schemas`, so the runtime
 * contract and the compile-time type can never drift. Enum types are re-exported from
 * `src/domain`. Import all domain types from this stable path:
 *
 *   import type { CaseState, RankedIntent, Decision } from '../types';
 */
import type { z } from 'zod';
import type {
  DetectedPIISchema,
  MaskingLogEntrySchema,
  RankedIntentSchema,
  IntentClassificationSchema,
  ExtractedSlotsSchema,
  SlotExtractionSchema,
  RetrievedSourceSchema,
  PDFRetrievalSchema,
  StructuredSourceSchema,
  BusinessRuleResultSchema,
  EvaluationSummarySchema,
  DecisionSchema,
  CaseStateSchema,
  AuditStageRecordSchema,
  AuditTraceSchema,
  FinalApiResponseSchema,
} from '../schemas';

// Enum value/union types (defined in src/domain), re-exported for a single type surface.
export type { Intent, Workflow, Decision, RiskLevel, ReasonCode } from '../domain';

// PII Sanitizer
export type DetectedPII = z.infer<typeof DetectedPIISchema>;
export type MaskingLogEntry = z.infer<typeof MaskingLogEntrySchema>;

// Intent Classification / Top-N Ranking
export type RankedIntent = z.infer<typeof RankedIntentSchema>;
export type IntentClassification = z.infer<typeof IntentClassificationSchema>;

// Slot Extraction
export type ExtractedSlots = z.infer<typeof ExtractedSlotsSchema>;
export type SlotExtraction = z.infer<typeof SlotExtractionSchema>;

// Retrieval
export type RetrievedSource = z.infer<typeof RetrievedSourceSchema>;
export type PDFRetrieval = z.infer<typeof PDFRetrievalSchema>;
export type StructuredSource = z.infer<typeof StructuredSourceSchema>;

// Decision Engine
export type BusinessRuleResult = z.infer<typeof BusinessRuleResultSchema>;
export type EvaluationSummary = z.infer<typeof EvaluationSummarySchema>;
/** Object outcome of the Decision Gate (distinct from the `Decision` enum value). */
export type DecisionResult = z.infer<typeof DecisionSchema>;

// Case assembly
export type CaseState = z.infer<typeof CaseStateSchema>;

// Audit
export type AuditStageRecord = z.infer<typeof AuditStageRecordSchema>;
export type AuditTrace = z.infer<typeof AuditTraceSchema>;

// Final output
export type FinalApiResponse = z.infer<typeof FinalApiResponseSchema>;
