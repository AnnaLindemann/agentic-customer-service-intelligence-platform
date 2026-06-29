import { z } from 'zod';

/** A policy passage retrieved from a PDF via cosine similarity. */
export const RetrievedSourceSchema = z.object({
  /** Citable reference, e.g. `cancellation-policy.pdf#p2`. */
  ref: z.string(),
  /** The retrieved passage text used for grounding. */
  snippet: z.string(),
  /** Cosine similarity score in [0, 1]. */
  score: z.number().min(0).max(1),
});

/** Output contract for the Semantic PDF Retrieval stage. */
export const PDFRetrievalSchema = z.object({
  query: z.string(),
  sources: z.array(RetrievedSourceSchema).default([]),
});

/** The kinds of business fact the Structured Data Retrieval stage can return. */
export const StructuredKindSchema = z.enum(['customer', 'order', 'invoice', 'product']);

/** A fact looked up deterministically from local JSON business data. */
export const StructuredSourceSchema = z.object({
  /** Citable reference, e.g. `order:10293`. */
  ref: z.string(),
  kind: StructuredKindSchema,
  /** The looked-up record. Shape varies by `kind`, so values are left unconstrained. */
  data: z.record(z.string(), z.unknown()),
});

/**
 * A record of one attempted structured lookup, kept whether or not it found a record, so the
 * retrieval step is explainable: it shows what was searched for and what resolved. This is
 * descriptive metadata only — it makes no judgement about sufficiency (that is a later stage).
 */
export const StructuredLookupSchema = z.object({
  kind: StructuredKindSchema,
  /** The key searched for (an order id, invoice id, product name or customer email). */
  key: z.string(),
  /** Whether a matching record was found. */
  found: z.boolean(),
  /** The resolved reference when `found` is true (e.g. `order:10293`). */
  ref: z.string().optional(),
});

/**
 * Metadata describing how an evidence set was assembled by the Hybrid Retrieval Layer.
 * Purely informational — it carries no decision and applies no business rule.
 */
export const RetrievalMetadataSchema = z.object({
  /** ISO-8601 timestamp of when retrieval ran. */
  retrievedAt: z.string(),
  structured: z.object({
    /** Slot keys that were available to drive lookups, in lookup order. */
    requested: z.array(z.string()).default([]),
    /** Every attempted lookup, with its outcome. */
    lookups: z.array(StructuredLookupSchema).default([]),
    /** Number of structured facts returned. */
    factsFound: z.number().int().nonnegative(),
  }),
  policy: z.object({
    /** Whether semantic PDF retrieval ran (skipped when the query was empty). */
    ran: z.boolean(),
    /** Maximum passages requested. */
    topN: z.number().int().nonnegative(),
    /** Minimum cosine similarity a passage had to clear. */
    minScore: z.number().min(0).max(1),
    /** Number of passages returned. */
    returned: z.number().int().nonnegative(),
    /** Highest similarity score among returned passages, or null when none. */
    topScore: z.number().min(0).max(1).nullable(),
    /** Embedding model backing the local vector index. */
    model: z.string(),
    /** Number of passages in the local vector index that were scored. */
    indexChunks: z.number().int().nonnegative(),
  }),
  /** Wall-clock timings (ms) for each retrieval path and the total. */
  timings: z.object({
    structuredMs: z.number().nonnegative(),
    semanticMs: z.number().nonnegative(),
    totalMs: z.number().nonnegative(),
  }),
});

/**
 * Output contract for the Hybrid Retrieval Layer (Structured Data Retrieval + Semantic PDF
 * Retrieval combined). It returns evidence only — structured business facts, policy evidence
 * with similarity scores, and retrieval metadata. It makes no decision and applies no
 * business rule (see ADR-002).
 */
export const HybridRetrievalSchema = z.object({
  /** The originating case id, when retrieval is run for a known case. */
  caseId: z.string().optional(),
  /** The query text used for semantic policy retrieval. */
  query: z.string(),
  /** Deterministic business facts from local JSON data. */
  structuredFacts: z.array(StructuredSourceSchema).default([]),
  /** Policy passages from the local vector index, each with a similarity score. */
  policyEvidence: z.array(RetrievedSourceSchema).default([]),
  metadata: RetrievalMetadataSchema,
});
