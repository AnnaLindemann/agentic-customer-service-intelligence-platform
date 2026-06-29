/**
 * Semantic PDF Retrieval barrel.
 *
 * The pipeline depends only on the stage entry point; the rest is exported for the build
 * script and for tests/inspection.
 *
 *   import { retrievePolicyPassages } from './pipeline/retrieval';
 */
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
