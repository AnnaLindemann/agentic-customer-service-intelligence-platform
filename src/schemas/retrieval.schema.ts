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

/** A fact looked up deterministically from local JSON business data. */
export const StructuredSourceSchema = z.object({
  /** Citable reference, e.g. `order:10293`. */
  ref: z.string(),
  kind: z.enum(['customer', 'order', 'invoice', 'product']),
  /** The looked-up record. Shape varies by `kind`, so values are left unconstrained. */
  data: z.record(z.string(), z.unknown()),
});
