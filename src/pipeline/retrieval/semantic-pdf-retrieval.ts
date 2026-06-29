/**
 * Semantic PDF Retrieval — the pipeline stage.
 *
 * Responsibility: given a query, return the most relevant policy passages from the local
 * vector index, ranked by cosine similarity over dense embeddings. This is the deterministic
 * retrieval stage from `docs/architecture.md`; it makes no LLM call and invents nothing —
 * every result is a verbatim passage from an approved policy PDF, with a citable reference.
 *
 * Output is validated against `PDFRetrievalSchema` (the Phase 2 contract) so downstream
 * stages receive a guaranteed shape: `{ query, sources: [{ ref, snippet, score }] }`.
 *
 * The stage is async because the local embedding model loads and runs asynchronously.
 */
import { PDFRetrievalSchema } from '../../schemas';
import type { PDFRetrieval } from '../../types';
import { cosineSimilarity, embed } from './embeddings';
import { ensureIndex, type PolicyIndex } from './policy-index';

/** Default number of passages returned. */
export const DEFAULT_TOP_N = 3;
/**
 * Default minimum cosine score; below this a passage is treated as not relevant. Tuned for
 * MiniLM embeddings, where on-topic policy passages score well above unrelated text.
 */
export const DEFAULT_MIN_SCORE = 0.25;

export interface RetrievalOptions {
  /** Maximum passages to return (default {@link DEFAULT_TOP_N}). */
  topN?: number;
  /** Minimum cosine similarity for a passage to be returned (default {@link DEFAULT_MIN_SCORE}). */
  minScore?: number;
  /**
   * A preloaded index to score against. When omitted the stage loads (and lazily builds)
   * the persisted index. Passing one in avoids re-reading the file across many queries.
   */
  index?: PolicyIndex;
}

/** Round a score to four decimals for stable, readable output. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * Retrieve the top policy passages relevant to `query`.
 *
 * Returns a schema-validated `PDFRetrieval`. When no passage clears `minScore` (including an
 * empty or off-topic query) `sources` is empty, which downstream stages can read as
 * "no grounding policy passage found".
 */
export async function retrievePolicyPassages(
  query: string,
  options: RetrievalOptions = {},
): Promise<PDFRetrieval> {
  const topN = options.topN ?? DEFAULT_TOP_N;
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const index = options.index ?? (await ensureIndex());

  const queryVector = await embed(query);

  const sources = index.chunks
    .map((chunk) => ({
      ref: chunk.ref,
      snippet: chunk.text,
      score: round4(cosineSimilarity(queryVector, chunk.vector)),
    }))
    .filter((source) => source.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  return PDFRetrievalSchema.parse({ query, sources });
}
