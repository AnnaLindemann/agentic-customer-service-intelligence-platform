# `src/pipeline/retrieval/` — Hybrid Retrieval Layer

The retrieval stages from [`docs/architecture.md`](../../../docs/architecture.md). The
**Hybrid Retrieval Layer** ([ADR-002](../../../docs/decisions.md)) combines two independent
retrieval paths and returns a single evidence bundle:

- **Structured Data Retrieval** — deterministic, key-based lookup of orders, invoices and
  inventory in the local JSON business data. Returns raw, citable records.
- **Semantic PDF Retrieval** — the most relevant company-policy passages for a query, ranked
  by cosine similarity over **dense embeddings** held in a **local vector index**. Embeddings
  are produced by a small sentence model that runs **locally**: no LLM call, no external
  embedding API, no external vector database (per the MVP constraints and
  [ADR-003](../../../docs/decisions.md)). Every result is a verbatim passage from an approved
  policy PDF with a citable reference.

This layer **retrieves evidence only**. It applies no business rule, evaluates no sufficiency
and makes no decision — those are later, separate stages (ADR-001).

## Modules

| File | Responsibility |
|------|----------------|
| `business-data.ts` | Load, validate and index the local JSON business data into lookup maps. |
| `structured-retrieval.ts` | The Structured Data Retrieval stage: resolve slots to business facts. |
| `pdf-text.ts` | Extract ordered pages of text from a generated policy PDF (dependency-free). |
| `chunking.ts` | Group page text into heading-delimited, citable passages. |
| `embeddings.ts` | Embed text with a local MiniLM model (`@huggingface/transformers`); dense cosine similarity. |
| `policy-index.ts` | Build, persist and load the local vector index (`data/vector-index/`). |
| `semantic-pdf-retrieval.ts` | The Semantic PDF Retrieval stage (async): embed a query and return the top passages. |
| `hybrid-retrieval.ts` | The Hybrid Retrieval Layer: run both paths and return the combined evidence bundle. |
| `index.ts` | Barrel — the pipeline imports `retrieveEvidence` (and the sub-stages) from here. |

## Usage

```ts
import { retrieveEvidence } from './pipeline/retrieval';

const evidence = await retrieveEvidence({
  caseId: 'case-123',
  slots: { orderId: '10001', customerEmail: 'emma.thompson@example.com' },
  query: 'Can I cancel my order placed an hour ago?',
});
// {
//   caseId, query,
//   structuredFacts: [{ ref: 'order:10001', kind: 'order', data: {...} }, ...],
//   policyEvidence:  [{ ref: 'customer-service-policy.pdf#p1', snippet: '...', score: 0.60 }, ...],
//   metadata: { retrievedAt, structured: { requested, lookups, factsFound }, policy: {...}, timings: {...} },
// }
```

The structured path is synchronous; the semantic path is **async** (the local model loads and
runs asynchronously), so `retrieveEvidence` is async. The output conforms to
`HybridRetrievalSchema`. When `query` is empty, semantic retrieval is **skipped**
(`policyEvidence` empty, `metadata.policy.ran === false`) — the caller supplies the query;
this layer never synthesizes one. When no passage clears the minimum score, `policyEvidence`
is empty — downstream this reads as "no grounding policy found".

The sub-stages can also be used directly: `retrieveStructuredFacts(slots)` (sync) and
`retrievePolicyPassages(query)` (async).

## Building the index

The index is generated from the PDFs in `data/pdfs/` and written to
`data/vector-index/policy-index.json` (git-ignored):

```
npm run build:index
```

`retrievePolicyPassages` builds the index automatically on first use if it is missing (and
rebuilds it if the embedding model changes), so the build step is optional for local runs but
explicit for deployment. The embedding model weights are downloaded once and cached under
`data/models/` (git-ignored); after that, retrieval runs offline.

## Design notes

- **Why a separate "hybrid" layer over the two stages?** The two retrieval paths are
  independent and have different shapes (exact records vs. scored passages). The hybrid layer
  runs them concurrently and packages a single, schema-validated evidence bundle with metadata,
  so downstream stages depend on one contract (`HybridRetrievalSchema`) rather than wiring two.
  This realizes ADR-002 ("Hybrid Retrieval").
- **Structured retrieval is lookup, not judgement.** It resolves slot keys (`orderId`,
  `invoiceId`, `productName`, `customerEmail`) to raw business records and records every
  attempted lookup (found or not) for explainability. It never decides eligibility, windows or
  sufficiency — that boundary keeps it deterministic and keeps business rules in their own
  later stage (ADR-001). The customer "fact" is a factual aggregation of a customer's orders
  and invoices, not a derived judgement.
- **Why local embeddings, not TF-IDF or an external API?** The architecture specifies "cosine
  similarity over a local index" and the docs describe embedding-based *semantic* retrieval.
  An interim TF-IDF model was rejected (lexical, not semantic) and an external embedding API
  was rejected (network dependency, non-deterministic). A small MiniLM model run locally via
  `@huggingface/transformers` gives real semantic matching while staying offline and free of
  any external vector database. See [ADR-008](../../../docs/decisions.md).
- **Why a custom PDF reader?** The policy PDFs are simple, uncompressed files produced by
  `scripts/generate-policy-pdfs.py`. A small parser recovers their text without adding a
  third-party PDF toolchain, matching the generator's dependency-free approach.
