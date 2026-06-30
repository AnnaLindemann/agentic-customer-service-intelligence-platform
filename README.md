# Explainable AI Customer Email Decision Engine

An AI-powered system that processes incoming customer service emails through a deterministic
pipeline and produces a **grounded draft response** with a full **audit trace**.

The project is designed as a production-oriented AI system rather than a chatbot demo.
It uses a hybrid architecture: LLMs handle language, deterministic rules handle decisions.

The system aims to automate supported customer service emails while escalating only cases
that are unsafe, unsupported or insufficiently grounded. Supported low-risk requests are
processed automatically; human review is reserved for exceptions.

> **LLMs interpret. Rules decide.**

See [docs/design-principles.md](docs/design-principles.md) for the full engineering philosophy.

---

## What It Does

For each incoming customer email, the system:

1. Removes personal data before any LLM call (PII Sanitizer).
2. Identifies the customer and the request (Slot Extraction + Structured Data Retrieval).
3. Understands intent and validates it is in scope.
4. Retrieves facts from internal business data and policy PDFs (hybrid retrieval).
5. Checks data sufficiency and company rules deterministically.
6. Decides whether to draft a reply or escalate to a human (Decision Gate).
7. Generates a grounded draft response, validated for compliance.
8. Records every step and reason code in an audit trace.

The output is a single structured JSON object: the draft (or an escalation), the supporting
evidence, the decisions taken, and the reasons for them.

---

## Current Status

**Phases 1–8 complete. Phase 9 — System Evaluation implemented and awaiting review.**

The complete pipeline, browser workbench, and offline synthetic evaluation harness are runnable.

---

## Architecture Principles

The project follows the principles in [docs/design-principles.md](docs/design-principles.md):

- LLMs interpret; deterministic rules decide.
- Agent responsibilities do not require LLM agents.
- Every decision is explainable and grounded in evidence.
- Safety is more important than automation; human escalation is a successful outcome.
- Human by exception: supported low-risk requests are auto-replied; escalation is the fallback.

See [docs/architecture.md](docs/architecture.md) for the processing pipeline.

---

## Documentation

| Document | Purpose |
|----------|---------|
| design-principles.md | Engineering philosophy (single source of truth) |
| architecture.md | System architecture and processing pipeline |
| roadmap.md | Implementation phases |
| engineering-workflow.md | Development workflow |
| ai-development-workflow.md | Rules for AI Coding Assistants |
| progress-log.md | Phase-by-phase record of completed work |
| decisions.md | Architecture Decision Records (ADR) |
| backlog.md | Future improvements (out of MVP scope) |
| evaluation.md | Phase 9 dataset, metrics and evaluation workflow |
| evaluation-report.md | Latest generated system-evaluation report |

---

## Development Workflow

Development follows a strict, phase-by-phase process. No implementation skips roadmap phases.
See [docs/engineering-workflow.md](docs/engineering-workflow.md) and
[docs/ai-development-workflow.md](docs/ai-development-workflow.md).

---

## Tech Stack (planned)

**Backend:** Node.js, TypeScript, Express
**Validation:** Zod (all LLM outputs are schema-validated)
**AI:** External LLM API, structured JSON output, prompt versioning
**Retrieval:** Local JSON business data; lightweight semantic PDF RAG over a local JSON
vector index with cosine similarity, using a small local sentence-embedding model
(`@huggingface/transformers`, MiniLM) — no external embedding API or vector database
(see [ADR-008](docs/decisions.md))
**PDF Processing:** dependency-free reader for the generated policy PDFs
**Infrastructure:** Docker, Docker Compose, Oracle Cloud Always Free
**Observability:** Audit trace, reason codes, prompt/version metadata, decision path logging

---

## Explicitly Out of Scope for MVP

- PostgreSQL
- LangGraph
- Self-hosted LangFuse
- External vector databases
- CRM integration
- Real email inbox integration
- Authentication
- Autonomous multi-agent loops

---

## Future Work (Not in MVP)

The following are deferred to the backlog and are **not** part of the MVP:

- Conversation Intelligence
- Business Insights Extraction
- Escalation review interface and evaluation dashboard

See [docs/backlog.md](docs/backlog.md).
