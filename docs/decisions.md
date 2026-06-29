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

---

# ADR-009

## Title

Hybrid Retrieval Layer — combined evidence contract and retrieval/decision boundary.

## Status

Accepted (implements ADR-002)

## Context

ADR-002 establishes *Hybrid Retrieval*: deterministic JSON lookup plus lightweight semantic
PDF retrieval. Phase 4 delivered only the semantic half; **Structured Data Retrieval** was
explicitly deferred. The two paths have different shapes — structured lookup returns exact
records (no score), semantic retrieval returns passages with a similarity score — and the
architecture lists them as two adjacent stages. A downstream consumer needs a single,
predictable evidence contract, and the boundary between *retrieving* evidence and *judging* it
must stay sharp (ADR-001: "LLMs interpret. Rules decide.").

## Decision

Add a **Hybrid Retrieval Layer** that composes two retrieval paths:

- **Structured Data Retrieval** (`structured-retrieval.ts`) resolves the slot keys `orderId`,
  `invoiceId`, `productName` and `customerEmail` to raw business records via deterministic
  lookup maps built over the local JSON data (`business-data.ts`, validated on load). It
  records every attempted lookup (found or not) for explainability, de-duplicates by `ref`,
  and returns facts only. A customer "fact" is a factual aggregation of that customer's orders
  and invoices — no derived judgement.
- **Hybrid Retrieval Layer** (`hybrid-retrieval.ts`, async) runs both paths (concurrently) and
  returns one schema-validated bundle, `HybridRetrievalSchema`:
  `{ caseId?, query, structuredFacts[], policyEvidence[], metadata }`. Similarity scores live
  on `policyEvidence`; `metadata` carries lookups attempted, policy parameters, index size and
  timings. The caller supplies the semantic `query` (e.g. the sanitized email); an empty query
  skips semantic retrieval rather than synthesizing one.
- The layer **retrieves evidence only**: no sufficiency evaluation, no business rule, no
  decision. Those remain later, separate stages.
- The persisted business-data record shapes are formalized as contracts in
  `src/schemas/business-data.schema.ts` (the shapes were implicit in Phase 3). Cross-record
  integrity stays in the standalone `validate-data` checker; the retrieval loader validates
  only that each record is individually well-formed.

## Consequences

Advantages:

- one contract for downstream consumers (`HybridRetrievalSchema`) instead of two;
- explainable retrieval (per-lookup outcomes; citable refs and scores);
- the retrieve/decide boundary is explicit, keeping business logic out of retrieval;
- structured lookups are deterministic, fast (indexed maps) and offline.

Trade-off:

- a small amount of schema duplication between `business-data.schema.ts` and the `validate-data`
  script (which keeps its own internal schemas plus cross-record checks);
- `metadata.timings` are wall-clock and therefore not reproducible across runs (they are
  descriptive only and carry no decision).

## Note on phase numbering

This work was requested as "Phase 5 — Hybrid Retrieval Layer". `docs/roadmap.md` lists
Structured + Semantic retrieval under Phase 4 and names Phase 5 "Decision Engine". The
deliverables here are the structured + hybrid retrieval the request described; the roadmap was
left unchanged per the engineering workflow (no roadmap edits without explicit instruction).

---

# ADR-010

## Title

Decision Engine — deterministic decision contract and two added reason codes.

## Status

Proposed (Phase 5 — Decision Engine; awaiting review)

## Context

Phase 5 implements the Decision Engine: **Data Sufficiency Evaluation**, the **Business Rule
Engine** and the **Decision Gate** (`docs/architecture.md`). The output contracts for these
stages already existed from Phase 2 (`evaluation.schema.ts`, `business-rule.schema.ts`,
`decision.schema.ts`). Two gaps surfaced during implementation:

1. The `ReasonCode` enum (the explainability vocabulary, ADR-006) had codes for every *negative*
   outcome a decision stage can report (`MISSING_REQUIRED_INFORMATION`, `STRUCTURED_DATA_MISSING`,
   `POLICY_MISSING`, `BUSINESS_RULE_CONFLICT`, `ESCALATION_REQUIRED`) but no *positive* code for
   "data is sufficient" or "a rule passed". The schemas require a `reasonCode`, and design
   principle 4 requires every recorded outcome — including the reasons an `AUTO_REPLY` was
   permitted — to be explainable. Reusing a semantically-wrong code (e.g. `AUTO_REPLY_ALLOWED`
   for a sufficiency result) would defeat that.
2. Consumers (Phase 6 Response Generation, Phase 7 Audit) need the three stage outputs together.

## Decision

- Add **two** reason codes to `src/domain/enums.ts`: `DATA_SUFFICIENT` (Data Sufficiency
  Evaluation passed) and `RULE_PASSED` (a business rule was satisfied). No existing code was
  changed. The set stays minimal: all negative/escalation paths reuse the existing codes.
- Add a single composed contract, `DecisionEngineResultSchema`
  (`{ caseId?, evaluation, ruleResults, decision }`), mirroring how the Hybrid Retrieval Layer
  packages its sub-stages (ADR-009), so downstream stages depend on one shape.
- Implement the engine as **deterministic and synchronous** under `src/pipeline/decision/`
  (ADR-001, ADR-005). The Decision Gate orders its checks most-fundamental first (scope →
  confidence → sufficiency → rules) so the reason code names the first blocker, and prefers
  `AUTO_REPLY` whenever every check passes (ADR-007). A missing *customer* slot yields
  `ASK_FOR_MORE_INFORMATION`; a gap on our side (unresolved record, missing policy) yields
  `HUMAN_ESCALATION`.
- The concrete business-rule thresholds (24h cancellation window; "only delivered orders may be
  reported damaged"; refunded/voided invoices need human review) are MVP defaults, isolated in
  `business-rules.ts` for the owner to adjust. They are not a published policy.

## Consequences

Advantages:

- positive outcomes are explainable with accurate reason codes; the audit trail can show why an
  auto-reply was allowed, not only why one was blocked;
- one decision contract for downstream stages; the retrieve/decide/respond boundaries stay sharp;
- the whole engine is deterministic, fast and unit-testable.

Trade-off:

- two additions to the canonical `ReasonCode` enum (ADR-006). They are additive and documented
  here for review; per the engineering workflow the change is not committed until approved.

## Note on phase numbering

This matches `docs/roadmap.md`: Phase 5 is "Decision Engine". (The earlier "Phase 5 — Hybrid
Retrieval Layer" request in ADR-009 corresponded to the roadmap's Phase 4 retrieval work.)
