/**
 * Response Generation barrel (Phase 6).
 *
 * The pipeline depends on `runResponseGeneration` (the composed stage: generate → validate →
 * structured output). The individual pieces are exported for tests and inspection.
 *
 *   import { runResponseGeneration } from './pipeline/response';
 */
export {
  runResponseGeneration,
  type ResponseGenerationInput,
} from './response-generator';

export {
  validateCompliance,
  isLikelyGerman,
  type ComplianceInput,
} from './compliance-validation';

export {
  buildResponsePrompt,
  collectStructuredPiiValues,
  prepareResponseEvidence,
  RESPONSE_PROMPT_VERSION,
  type BuiltResponsePrompt,
  type PreparedResponseEvidence,
  type ResponsePromptInput,
} from './prompt';
