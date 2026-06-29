# Progress Log

A chronological record of completed work, phase by phase. Each entry is added when
a roadmap phase is implemented and submitted for review.

---

## Phase 4 — Lightweight Semantic PDF RAG

**Date:** 2026-06-29
**Status:** Implemented — awaiting review

### Scope

The **Semantic PDF Retrieval** stage of the roadmap's Phase 4 (Retrieval): retrieving
relevant company-policy passages from the local PDFs via cosine similarity over a local
vector index. This is the deliverable the request named ("Lightweight Semantic PDF RAG").

The other half of roadmap Phase 4 — **Structured Data Retrieval** (JSON business-data
lookup) — is intentionally **not** implemented here; it was outside the named scope. No
later-phase functionality (Decision Engine, Response Generator, etc.) is included.

Retrieval uses a **local sentence-embedding model** for genuine semantic similarity. An
interim TF-IDF implementation was built first and then **rejected** during review because its
similarity was lexical, not semantic (see ADR-008 History).

### Completed

- **`src/pipeline/retrieval/`** — the retrieval stage, one responsibility per module:
  - `pdf-text.ts` — dependency-free extraction of ordered page text from the generated
    policy PDFs (parses the uncompressed content streams; marks heading lines).
  - `chunking.ts` — groups page text into heading-delimited, citable passages
    (`<slug>.pdf#p<n>`).
  - `embeddings.ts` — embeds text with a local MiniLM model (`Xenova/all-MiniLM-L6-v2`,
    384-dim) via `@huggingface/transformers`, plus dense cosine similarity. No external API.
  - `policy-index.ts` — builds, persists and loads the local vector index (dense embeddings)
    under `data/vector-index/` (git-ignored); validates the file on load with Zod; rebuilds on
    a model/version mismatch.
  - `semantic-pdf-retrieval.ts` — `retrievePolicyPassages(query, options?)` (async),
    returning a `PDFRetrieval` validated against the Phase 2 `PDFRetrievalSchema`.
  - `index.ts`, `README.md`.
- **`src/scripts/build-pdf-index.ts`** + `npm run build:index` — explicit index build.
- **Dependency** — `@huggingface/transformers` (local ONNX inference). Model weights cached
  under `data/models/` (git-ignored).
- **Docs** — [ADR-008](decisions.md) (local embeddings; records why TF-IDF was rejected);
  module README; `data/README.md` and root `README.md` updated.

### Verification

- `npm run build` compiles cleanly (TypeScript strict).
- `npm run build:index` builds the index: model `Xenova/all-MiniLM-L6-v2` (384-dim),
  3 documents, 39 passages.
- Retrieval smoke test over representative queries returns the correct policy and page:
  cancellation → `customer-service-policy.pdf#p1` (cancellation eligibility);
  damaged item → damaged-product/refund sections; invoice question →
  `billing-policy.pdf#p2` (answering invoice questions); availability →
  `product-availability-policy.pdf` availability sections.
- **Semantic check:** the paraphrase *"how do I call off my purchase?"* (no shared vocabulary
  with "cancel") retrieves the **Order Cancellations** section — which the lexical TF-IDF
  model could not.
- An off-topic/gibberish query returns **no sources** (the "no grounding policy" path).
- Output is schema-valid; scores lie in `[0, 1]`.

### Notes

- **Local, not external.** Embeddings run locally via ONNX (no external embedding API, no
  external vector database). Model weights are fetched once and cached, then run offline.
  Embedding from fixed weights is deterministic, consistent with the stage's classification.
- **README reconciled.** The root README's planned stack had named embeddings via an external
  API and `pdf-parse`; the implementation keeps embeddings **local** and uses a dependency-free
  PDF reader. The README line was updated and ADR-008 records the rationale.

### Known limitations

- Similarity quality is bounded by a small model on short, heading-sized passages; some
  paraphrases rank a related-but-not-best section first. The `minScore` threshold (default
  0.25) keeps off-topic queries from matching.
- Adds the `@huggingface/transformers` dependency and a one-time model download (cached
  locally); `retrievePolicyPassages` is now async.
- The PDF reader parses only the uncompressed PDFs this project generates, not arbitrary PDFs.
- Passages are cited by the page on which their heading starts; a section spanning a page
  break cites its start page.

### Suggested improvements

- Optional larger/instruction-tuned local embedding model behind the same interface.
- Sub-section splitting and overlap windows if policies grow; drop heading-only chunks.

---

## Phase 2 — Domain Model & Validation Contracts

**Date:** 2026-06-28
**Status:** Implemented — awaiting review

### Scope

The domain-model and Zod-validation slice of the roadmap's Phase 2 (Core Infrastructure):
the internal domain vocabulary and the runtime validation contracts that later pipeline
stages will produce and consume. The Express API portion of Phase 2 is intentionally
deferred. No business logic, retrieval, LLM calls, API endpoints or pipeline execution
are included.

### Completed

- **`src/domain/`** — enums as the single source of vocabulary: `Intent`, `Workflow`,
  `Decision`, `RiskLevel`, `ReasonCode`. Each is a frozen const object plus a union type
  plus a value tuple (e.g. `INTENTS`) used to seed Zod enums. No Zod dependency here.
- **`src/schemas/`** — one focused Zod schema module per contract:
  `IntentClassificationSchema`, `SlotExtractionSchema`, `PDFRetrievalSchema`,
  `BusinessRuleResultSchema`, `DecisionSchema`, `CaseStateSchema`,
  `FinalApiResponseSchema`, plus the supporting sub-schemas they compose from
  (PII, ranked intent, slots, retrieved/structured source, evaluation, audit).
- **`src/types/`** — every core type (`CaseState`, `RetrievedSource`,
  `EvaluationSummary`, `AuditTrace`, `DetectedPII`, `MaskingLogEntry`, `RankedIntent`,
  `ExtractedSlots`, `StructuredSource`, `BusinessRuleResult`, …) inferred from its schema
  via `z.infer`, so runtime and compile-time contracts cannot drift. Enum types are
  re-exported here for a single type surface.
- Barrels (`index.ts`) for `domain/`, `schemas/` and `types/` give later modules stable
  import paths.

### Verification

- `npm run build` compiles cleanly (TypeScript strict).
- Runtime smoke check: enum tuples populate (6 intents, 3 decisions, 11 reason codes);
  a valid `IntentClassificationSchema` payload parses; an invalid intent is rejected;
  `FinalApiResponseSchema` parses and applies array defaults.

### Notes

- `DecisionSchema`'s inferred object type is exported as `DecisionResult` to avoid a name
  clash with the `Decision` enum value/type.
- All ten requested core types are schema-backed and inferred rather than hand-written,
  to honour "prefer Zod schemas as the source of runtime validation" and to keep a single
  source of truth.

---

## Phase 1 — Foundation

**Date:** 2026-06-28
**Status:** Implemented — awaiting review

### Scope

Repository setup, documentation, project structure, and a development environment that
yields a **runnable Express backend** exposing `GET /health`, runnable both locally and
via Docker. Per the roadmap this phase configures TypeScript and Express and installs
Zod and dotenv. No pipeline modules or business logic are included; Phase 2 is not started.

### Completed

- **Development environment & toolchain**
  - `package.json` with runtime deps (`express`, `zod`, `dotenv`) and dev deps
    (`typescript`, `@types/express`, `@types/node`). Node `>=20`, private.
  - `tsconfig.json` — minimal strict config; CommonJS output to `dist/` from `src/`.
  - Pinned Node version with `.nvmrc`.
- **Runnable backend**
  - `src/index.ts` — Express app bootstrap exposing `GET /health` → `200 {"status":"ok"}`.
    No other routes.
  - `src/config/env.ts` — loads `.env` via dotenv and validates `NODE_ENV`/`PORT` with Zod;
    exits non-zero on invalid configuration.
- **Docker support**
  - `docker/Dockerfile` — builds the TypeScript app and runs `node dist/index.js`.
  - `docker/docker-compose.yml` — builds/runs the service on port 3000 with a `/health`
    healthcheck.
  - `.dockerignore`.
- **Project structure**
  - `src/` (`config/`, `types/`, `pipeline/`) and `data/` (`business/`, `policies/`)
    skeletons with READMEs mapped to the architecture; `tests/` placeholder.
- **Repository setup & documentation**
  - `.github/pull_request_template.md` reflecting the engineering-workflow checklist.
  - This progress log; README documentation table updated.

### Verification

- `npm install` succeeds; `package-lock.json` committed.
- `npm run build` compiles cleanly with no errors (TypeScript strict).
- App starts: `node dist/index.js` logs `Server listening on port <PORT>`.
- `GET /health` returns **HTTP 200** with body `{"status":"ok"}` (verified on default
  port 3000 and on a custom `PORT=4100`). Unknown routes return 404.
- Docker: not validated in the current environment — the Docker CLI is unavailable in
  this WSL distro. The `Dockerfile`/`compose` files are standard and ready to build where
  Docker is available.

### Notes

- The roadmap Phase 1 status is intentionally left as "In Progress"; it is marked
  complete only after human review and commit, per the roadmap completion rules.
- An earlier draft of this entry deferred TypeScript/Express/Zod/dotenv to Phase 2;
  that was corrected to match the roadmap, which places them in Phase 1.
