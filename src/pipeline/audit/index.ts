/**
 * Audit & Evaluation barrel (Phase 7).
 *
 * A passive observability layer. It records what happened during processing — LLM call
 * metadata, the decision, compliance outcomes, derived evaluation signals — and never changes
 * any decision or blocks any response. The two entry points the pipeline uses are:
 *
 *   import { instrumentLlmClient, createLlmCallRecorder, buildAuditTrace } from './pipeline/audit';
 *
 * `instrumentLlmClient` wraps the LLM client to collect per-call metadata; `buildAuditTrace`
 * assembles the final, frontend-ready `AuditRecord` from the stages' outputs.
 */
export {
  buildAuditTrace,
  PIPELINE_VERSION,
  type BuildAuditTraceInput,
} from './audit-trace';

export {
  instrumentLlmClient,
  createLlmCallRecorder,
  type LlmCallRecorder,
  type InstrumentOptions,
} from './llm-recorder';

export { deriveEvaluationMetrics } from './evaluation-metrics';

export {
  estimateCostUsd,
  getModelPrice,
  MODEL_PRICES,
  type ModelPrice,
} from './pricing';
