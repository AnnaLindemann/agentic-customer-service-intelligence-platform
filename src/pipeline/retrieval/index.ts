/**
 * Retrieval barrel — the Hybrid Retrieval Layer (Structured Data Retrieval + Semantic PDF
 * Retrieval) plus the lower-level pieces.
 *
 * The pipeline depends only on the stage entry points (`retrieveEvidence`,
 * `retrieveStructuredFacts`, `retrievePolicyPassages`); the rest is exported for the build
 * script and for tests/inspection.
 *
 *   import { retrieveEvidence } from './pipeline/retrieval';
 */

// Hybrid Retrieval Layer — the combined stage entry point.
export {
  retrieveEvidence,
  type HybridRetrievalInput,
  type HybridRetrievalOptions,
} from './hybrid-retrieval';

// Structured Data Retrieval.
export {
  retrieveStructuredFacts,
  type StructuredQuery,
  type StructuredRetrievalOptions,
  type StructuredRetrievalResult,
} from './structured-retrieval';
export {
  loadBusinessData,
  normalizeName,
  BUSINESS_DIR,
  type BusinessData,
  type LoadOptions,
} from './business-data';

// Semantic PDF Retrieval.
export {
  retrievePolicyPassages,
  DEFAULT_TOP_N,
  DEFAULT_MIN_SCORE,
  type RetrievalOptions,
} from './semantic-pdf-retrieval';
export {
  buildIndex,
  saveIndex,
  loadIndex,
  ensureIndex,
  PDF_DIR,
  INDEX_DIR,
  INDEX_PATH,
  type PolicyIndex,
  type IndexedChunk,
} from './policy-index';
export { EMBEDDING_MODEL, EMBEDDING_DIM } from './embeddings';
export { type PolicyChunk } from './chunking';
