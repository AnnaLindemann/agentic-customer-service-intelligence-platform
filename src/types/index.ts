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
  StructuredLookupSchema,
  RetrievalMetadataSchema,
  HybridRetrievalSchema,
  OrderRecordSchema,
  InvoiceRecordSchema,
  InventoryRecordSchema,
  BusinessRuleResultSchema,
  EvaluationSummarySchema,
  DecisionSchema,
  DecisionEngineResultSchema,
  CaseStateSchema,
  AuditStageRecordSchema,
  AuditTraceSchema,
  LlmDraftSchema,
  ComplianceCheckSchema,
  ComplianceResultSchema,
  CitedEvidenceSchema,
  GeneratedResponseSchema,
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
export type StructuredLookup = z.infer<typeof StructuredLookupSchema>;
export type RetrievalMetadata = z.infer<typeof RetrievalMetadataSchema>;
/** Combined output of the Hybrid Retrieval Layer (structured facts + policy evidence). */
export type HybridRetrieval = z.infer<typeof HybridRetrievalSchema>;

// Local business-data record shapes (read by Structured Data Retrieval)
export type OrderRecord = z.infer<typeof OrderRecordSchema>;
export type InvoiceRecord = z.infer<typeof InvoiceRecordSchema>;
export type InventoryRecord = z.infer<typeof InventoryRecordSchema>;

// Decision Engine
export type BusinessRuleResult = z.infer<typeof BusinessRuleResultSchema>;
export type EvaluationSummary = z.infer<typeof EvaluationSummarySchema>;
/** Object outcome of the Decision Gate (distinct from the `Decision` enum value). */
export type DecisionResult = z.infer<typeof DecisionSchema>;
/** Combined output of the Decision Engine (sufficiency + rules + gate decision). */
export type DecisionEngineResult = z.infer<typeof DecisionEngineResultSchema>;

// Case assembly
export type CaseState = z.infer<typeof CaseStateSchema>;

// Audit
export type AuditStageRecord = z.infer<typeof AuditStageRecordSchema>;
export type AuditTrace = z.infer<typeof AuditTraceSchema>;

// Response Generation (Phase 6)
/** Raw LLM output of the Response Generator, before deterministic validation. */
export type LlmDraft = z.infer<typeof LlmDraftSchema>;
export type ComplianceCheck = z.infer<typeof ComplianceCheckSchema>;
export type ComplianceResult = z.infer<typeof ComplianceResultSchema>;
export type CitedEvidence = z.infer<typeof CitedEvidenceSchema>;
/** Structured JSON Output of Phase 6 (draft + cited evidence + compliance + echoed decision). */
export type GeneratedResponse = z.infer<typeof GeneratedResponseSchema>;

// Final output
export type FinalApiResponse = z.infer<typeof FinalApiResponseSchema>;
