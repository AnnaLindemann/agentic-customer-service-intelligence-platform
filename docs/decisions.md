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