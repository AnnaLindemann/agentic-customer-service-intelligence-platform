import { z } from 'zod';
import { EvaluationSummarySchema } from './evaluation.schema';
import { BusinessRuleResultSchema } from './business-rule.schema';
import { DecisionSchema } from './decision.schema';

/**
 * Combined output contract for the Decision Engine (Phase 5). It bundles the three
 * deterministic decision stages into one schema-validated result so downstream consumers
 * (Response Generation, Audit) depend on a single contract rather than wiring three:
 *
 *   - `evaluation`  — Data Sufficiency Evaluation: is there enough evidence to answer safely?
 *   - `ruleResults` — Business Rule Engine: the per-rule outcomes applied to the case.
 *   - `decision`    — Decision Gate: exactly one action, with its risk level and reason code.
 *
 * This mirrors the Hybrid Retrieval Layer's single-bundle contract (ADR-009). The Decision
 * Engine consumes evidence and produces a decision; it generates no customer-facing text.
 */
export const DecisionEngineResultSchema = z.object({
  /** The originating case id, when the engine is run for a known case. */
  caseId: z.string().optional(),
  evaluation: EvaluationSummarySchema,
  ruleResults: z.array(BusinessRuleResultSchema).default([]),
  decision: DecisionSchema,
});
