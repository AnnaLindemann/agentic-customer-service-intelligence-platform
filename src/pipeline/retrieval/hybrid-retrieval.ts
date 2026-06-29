/**
 * Hybrid Retrieval Layer — combine Structured Data Retrieval and Semantic PDF Retrieval.
 *
 * Responsibility: assemble the evidence an email case needs by running both retrieval paths
 * and returning a single, schema-validated bundle: structured business facts, policy evidence
 * with similarity scores, and retrieval metadata. This is the architecture's "hybrid retrieval"
 * (ADR-002): deterministic JSON lookup plus lightweight semantic PDF retrieval.
 *
 * This layer retrieves evidence only. It applies no business rule, evaluates no sufficiency
 * and makes no decision — those are later, separate stages (ADR-001). The two paths are
 * independent, so they run concurrently.
 *
 * The stage is async because Semantic PDF Retrieval loads and runs a local embedding model.
 */
import { HybridRetrievalSchema } from '../../schemas';
import type { HybridRetrieval } from '../../types';
import { ensureIndex, type PolicyIndex } from './policy-index';
import {
  DEFAULT_MIN_SCORE,
  DEFAULT_TOP_N,
  retrievePolicyPassages,
} from './semantic-pdf-retrieval';
import {
  retrieveStructuredFacts,
  type StructuredQuery,
  type StructuredRetrievalOptions,
} from './structured-retrieval';
import { loadBusinessData, type BusinessData } from './business-data';

export interface HybridRetrievalInput {
  /** The originating case id, recorded on the output when present. */
  caseId?: string;
  /** Structured slots that drive the deterministic business-data lookups. */
  slots: StructuredQuery;
  /**
   * Free text used for semantic policy retrieval (e.g. the sanitized email body). When empty
   * or whitespace, semantic retrieval is skipped and `policyEvidence` is empty — the caller
   * is responsible for supplying a query; this layer does not synthesize one.
   */
  query: string;
}

export interface HybridRetrievalOptions {
  /** Max policy passages to return (default {@link DEFAULT_TOP_N}). */
  topN?: number;
  /** Minimum cosine similarity for a passage (default {@link DEFAULT_MIN_SCORE}). */
  minScore?: number;
  /** Preloaded business data, to avoid re-reading the JSON across many cases. */
  data?: BusinessData;
  /** Preloaded policy index, to avoid re-reading the vector index across many cases. */
  index?: PolicyIndex;
}

/** Millisecond elapsed time since a `performance.now()` style start, rounded. */
function elapsed(start: number): number {
  return Math.round(performance.now() - start);
}

/**
 * Run both retrieval paths for a case and return the combined evidence bundle.
 *
 * The result conforms to `HybridRetrievalSchema`: structured facts (no scores — exact
 * lookups), policy evidence (each with a cosine similarity score), and metadata describing how
 * the set was assembled (lookups attempted, policy parameters, index size, timings).
 */
export async function retrieveEvidence(
  input: HybridRetrievalInput,
  options: HybridRetrievalOptions = {},
): Promise<HybridRetrieval> {
  const topN = options.topN ?? DEFAULT_TOP_N;
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const data = options.data ?? loadBusinessData();
  const query = input.query ?? '';
  const runSemantic = query.trim().length > 0;

  const totalStart = performance.now();

  // --- structured (synchronous, but timed for the metadata) ---
  const structuredStart = performance.now();
  const structuredOptions: StructuredRetrievalOptions = { data };
  const structured = retrieveStructuredFacts(input.slots, structuredOptions);
  const structuredMs = elapsed(structuredStart);

  // --- semantic (async; only when a query is present) ---
  const index = options.index ?? (runSemantic ? await ensureIndex() : undefined);
  const semanticStart = performance.now();
  const policy = runSemantic
    ? await retrievePolicyPassages(query, { topN, minScore, index })
    : { query, sources: [] };
  const semanticMs = runSemantic ? elapsed(semanticStart) : 0;

  const policyEvidence = policy.sources;
  const topScore = policyEvidence.length > 0 ? policyEvidence[0].score : null;
  const indexChunks = index?.chunks.length ?? 0;
  const model = index?.model ?? '';

  const requested = (['orderId', 'invoiceId', 'productName', 'customerEmail'] as const).filter(
    (key) => Boolean(input.slots[key]?.trim()),
  );

  return HybridRetrievalSchema.parse({
    caseId: input.caseId,
    query,
    structuredFacts: structured.sources,
    policyEvidence,
    metadata: {
      retrievedAt: new Date().toISOString(),
      structured: {
        requested,
        lookups: structured.lookups,
        factsFound: structured.sources.length,
      },
      policy: {
        ran: runSemantic,
        topN,
        minScore,
        returned: policyEvidence.length,
        topScore,
        model,
        indexChunks,
      },
      timings: {
        structuredMs,
        semanticMs,
        totalMs: elapsed(totalStart),
      },
    },
  });
}
