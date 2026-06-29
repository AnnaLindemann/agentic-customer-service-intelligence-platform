# Architecture Decision Records (ADR)

This document records important architectural decisions made during the project.

Every significant change must be documented here.

---

# ADR-001

## Title

LLMs interpret. Rules decide.

## Status

Accepted

## Context

The system processes customer emails that may affect business decisions.

LLMs provide strong language understanding but should not be trusted with business-critical decisions.

## Decision

Use LLMs only for language-related tasks:

- intent classification
- top-N intent ranking
- slot extraction
- draft response generation

Business-critical logic remains deterministic.

## Consequences

Advantages:

- safer system
- explainable decisions
- easier testing
- lower hallucination risk

Trade-off:

- more deterministic code must be implemented.

---

# ADR-002

## Title

Hybrid Retrieval

## Status

Accepted

## Context

The interview task requires retrieving information from both structured business data and PDF documents.

## Decision

Use two retrieval mechanisms:

- deterministic JSON lookup
- lightweight semantic PDF retrieval

## Consequences

Advantages:

- grounded responses
- realistic enterprise architecture
- lightweight infrastructure

Trade-off:

- additional retrieval pipeline.

---

# ADR-003

## Title

Local Infrastructure for MVP

## Status

Accepted

## Context

The prototype targets Oracle Cloud Always Free.

Infrastructure must remain lightweight.

## Decision

Use:

- local JSON business data
- local vector index
- Docker
- no PostgreSQL
- no external vector database

## Consequences

Advantages:

- low resource usage
- simple deployment
- interview-friendly architecture

Trade-off:

- limited scalability.

---

# ADR-004

## Title

PII masking must always happen before any LLM call.

## Status

Accepted

## Context

Customer emails contain personal data (names, addresses, emails, order details).
LLM calls may be processed by an external API, so raw PII must never leave the system
in a prompt.

## Decision

The PII Sanitizer is the first stage of the pipeline and runs deterministically before any
LLM-powered stage (Intent Classification, Slot Extraction, Response Generator). No stage may
send unmasked personal data to an LLM.

## Consequences

Advantages:

- personal data is protected before any external processing
- privacy guarantee is deterministic and auditable
- compliance posture is stronger by construction

Trade-off:

- downstream stages operate on masked text and must reconcile masked tokens with
  structured data retrieved deterministically.

---

# ADR-005

## Title

Responsibility boundaries do not imply LLM-based agents.

## Status

Accepted

## Context

The task is framed around agent-like responsibilities (customer identification, retrieval,
rule validation, escalation). A naive reading would implement each responsibility as an
autonomous LLM agent. That increases cost, latency and hallucination risk, and weakens
auditability.

## Decision

A responsibility boundary is a unit of accountability, not a mandatory LLM call. Each
responsibility is implemented as a deterministic module whenever deterministic code can
achieve acceptable quality. LLMs are used only for language understanding and language
generation (Intent Classification, Top-N Intent Ranking, Slot Extraction, Response Generator).

Deterministic implementations are preferred because they are testable, repeatable,
explainable via reason codes, cheaper, lower-latency, and cannot hallucinate business
decisions. See [design-principles.md](design-principles.md).

## Consequences

Advantages:

- fewer LLM calls; lower cost and latency
- stronger auditability and safety
- most pipeline stages are deterministic and unit-testable

Trade-off:

- more deterministic code must be written and maintained.

---

# ADR-006

## Title

Phase 2 establishes the canonical domain enum values.

## Status

Accepted

## Context

Early documentation (the architecture worked example) used informal decision values such
as `draft` and `escalate`. Phase 2 introduces the typed domain model in code, which must
be the single source of truth for the pipeline's vocabulary.

## Decision

The canonical enum values live in `src/domain` and are enforced at runtime by Zod schemas
in `src/schemas`:

- `Intent`: `cancellation_request`, `damaged_item`, `invoice_question`,
  `product_availability`, `unknown`, `out_of_scope`
- `Workflow`: `cancellation`, `damaged_item`, `invoice`, `product_availability`,
  `unsupported`
- `Decision`: `AUTO_REPLY`, `ASK_FOR_MORE_INFORMATION`, `HUMAN_ESCALATION`
- `RiskLevel`: `low`, `medium`, `high`
- `ReasonCode`: the explainability codes defined in `src/domain/enums.ts`

The architecture worked example was updated to use the canonical `Decision` values. Any
`reasonCode` literals shown in that example remain illustrative and non-normative.

## Consequences

Advantages:

- one source of truth for the domain vocabulary, enforced at runtime
- documentation and code no longer disagree on decision values

Trade-off:

- documentation examples must track the enum definitions when they change.

---

# ADR-007

## Title

Human by Exception

## Status

Accepted

## Context

The employer's goal is maximum safe automation.

## Decision

Supported low-risk customer service requests should result in `AUTO_REPLY` whenever
deterministic validation succeeds.

Human escalation is used only for unsupported, ambiguous, risky or policy-conflicting
requests.

## Consequences

Advantages:

- higher automation
- lower operating cost
- better alignment with the project goals

Trade-off:

- the system requires stronger deterministic validation before automatic replies.

---

# ADR-008

## Title

Local sentence-embedding model for Semantic PDF Retrieval (TF-IDF rejected).

## Status

Accepted (supersedes an interim TF-IDF implementation — see History)

## Context

`docs/architecture.md` lists Semantic PDF Retrieval as a *deterministic* stage —
"cosine similarity over a local index" — and the MVP constraints forbid an external vector
database. The supporting docs (`data/README.md`, the PDF-generator docstring, the root
`README.md` planned stack) describe the stage as **embedding**-based semantic retrieval.
Two implementation choices follow: how to turn policy text into vectors, and how to read the
policy PDFs.

An external embeddings API was considered and rejected: it would add a network dependency,
cost, and a non-deterministic external call, conflicting with the stage's deterministic
classification and the "prefer deterministic" principle.

A first implementation used a **TF-IDF vector-space model**. It was deterministic and
dependency-free, but its similarity is **lexical**: it matches only on shared terms, so a
paraphrase such as "call off my purchase" does not match the *cancellation* policy because it
shares no vocabulary with it. That under-delivers on the word *semantic*. TF-IDF was therefore
rejected in favour of true embeddings, with the requirement that they remain **local**.

## Decision

Implement Semantic PDF Retrieval with a **local sentence-embedding model** and cosine
similarity over a **local, file-based index** (`data/vector-index/policy-index.json`):

- passages and queries are embedded with `Xenova/all-MiniLM-L6-v2` (384-dim) run **locally**
  via `@huggingface/transformers` (ONNX Runtime, CPU). The model weights are fetched once and
  cached under `data/models/` (git-ignored); after that, embedding is fully offline;
- dense, L2-normalized embeddings are stored in the local index; a query is embedded the same
  way and scored against every passage by cosine similarity;
- the policy PDFs are read by a small, dependency-free parser that understands the
  uncompressed PDFs produced by `scripts/generate-policy-pdfs.py`, rather than adding a
  third-party PDF library.

There is **no external embedding API** (at build or query time) and **no external vector
database**: ADR-003 and the MVP constraints hold. Embedding generation from fixed model
weights is deterministic, so the stage's deterministic classification also holds.

## Consequences

Advantages:

- genuine **semantic** matching — paraphrases with no shared vocabulary are retrieved;
- still local, offline (after the one-time model download) and reproducible — no API keys,
  per-call cost, or runtime network;
- explainable: every hit is a verbatim, citable policy passage.

Trade-off:

- adds the `@huggingface/transformers` dependency and its ONNX runtime, and a one-time model
  download (~tens of MB, cached). This is heavier than the stdlib-only retrieval but stays
  within the local/offline constraints and is comfortable for the Oracle Always Free target;
- the retrieval stage (`retrievePolicyPassages`) is now **async** (the model loads and runs
  asynchronously);
- the custom PDF reader is intentionally narrow: it parses only the PDFs this project
  generates, not arbitrary PDFs.

## History

- Interim: TF-IDF vector-space model (lexical cosine over a local index). Rejected because the
  similarity was lexical rather than semantic. Superseded by the local embedding model above;
  the index format was bumped from version 1 (sparse TF-IDF) to version 2 (dense embeddings).