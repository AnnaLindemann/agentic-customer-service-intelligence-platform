# `src/pipeline/retrieval/` — Semantic PDF Retrieval

The **Semantic PDF Retrieval** stage from [`docs/architecture.md`](../../../docs/architecture.md).
It retrieves the most relevant company-policy passages for a query, ranked by cosine
similarity over **dense embeddings** held in a **local vector index**. Embeddings are produced
by a small sentence model that runs **locally**: no LLM call, no external embedding API, no
external vector database (per the MVP constraints and [ADR-003](../../../docs/decisions.md)).
Every result is a verbatim passage from an approved policy PDF with a citable reference, so
downstream stages can ground responses in evidence.

## Modules

| File | Responsibility |
|------|----------------|
| `pdf-text.ts` | Extract ordered pages of text from a generated policy PDF (dependency-free). |
| `chunking.ts` | Group page text into heading-delimited, citable passages. |
| `embeddings.ts` | Embed text with a local MiniLM model (`@huggingface/transformers`); dense cosine similarity. |
| `policy-index.ts` | Build, persist and load the local vector index (`data/vector-index/`). |
| `semantic-pdf-retrieval.ts` | The stage (async): embed a query and return the top passages. |
| `index.ts` | Barrel — the pipeline imports `retrievePolicyPassages` from here. |

## Usage

```ts
import { retrievePolicyPassages } from './pipeline/retrieval';

const result = await retrievePolicyPassages('Can I cancel my order placed an hour ago?');
// { query, sources: [{ ref: 'customer-service-policy.pdf#p1', snippet: '...', score: 0.63 }, ...] }
```

The stage is **async** (the local model loads and runs asynchronously). The output conforms
to `PDFRetrievalSchema` (the Phase 2 contract). When no passage clears the minimum score,
`sources` is empty — downstream this reads as "no grounding policy found".

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

- **Why local embeddings, not TF-IDF or an external API?** The architecture specifies "cosine
  similarity over a local index" and the docs describe embedding-based *semantic* retrieval.
  An interim TF-IDF model was rejected (lexical, not semantic) and an external embedding API
  was rejected (network dependency, non-deterministic). A small MiniLM model run locally via
  `@huggingface/transformers` gives real semantic matching while staying offline and free of
  any external vector database. See [ADR-008](../../../docs/decisions.md).
- **Why a custom PDF reader?** The policy PDFs are simple, uncompressed files produced by
  `scripts/generate-policy-pdfs.py`. A small parser recovers their text without adding a
  third-party PDF toolchain, matching the generator's dependency-free approach.
