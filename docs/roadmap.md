# Project Roadmap

## Purpose

This roadmap describes the implementation phases of the MVP.

Each phase must be completed, reviewed and approved before the next phase begins.

Architecture changes require an Architecture Decision Record (ADR).

---

# Phase 1 — Foundation 

- Repository setup
- Documentation
- Project structure
- Development environment

Status: DONE

---

# Phase 2 — Core Infrastructure

- Express API
- TypeScript configuration
- Zod validation
- Project modules

Status: DONE
---

# Phase 3 — Customer Email Pipeline

- Email ingestion
- PII Sanitizer
- Intent Classification
- Top-N Intent Ranking
- Scope Validation
- Slot Extraction
- Workflow Enrichment
- Case State Builder
Status: DONE
---

# Phase 4 — Retrieval

- Structured Data Retrieval
- Semantic PDF Retrieval
Status: DONE
---

# Phase 5 — Decision Engine

- Data Sufficiency Evaluation
- Business Rule Engine
- Decision Gate

Status: DONE

---

# Phase 6 — LLM Integration

Goal

Safely integrate the LLM into the deterministic pipeline.

Implementation

- Provider abstraction
- Groq provider
- Prompt templates
- Intent Classification
- Top-N Intent Ranking
- Slot Extraction
- Response Generator
- Compliance Validation
- Structured JSON Output
- Zod validation
- Retry on invalid JSON
- Prompt versioning

Deliverable

Reliable LLM integration where the LLM performs language understanding and response generation while deterministic modules remain responsible for business decisions.

Status: DONE
---

# Phase 7 — Audit & Evaluation

Goal

Provide complete transparency and observability for every AI interaction.

Implementation

- Audit Trace
- Prompt metadata
- Provider metadata
- Model metadata
- Token usage
- Estimated cost
- Latency
- Retry count
- JSON validation result
- Decision metadata
- Evaluation metrics

Deliverable

A fully explainable execution trace for every processed customer request.

Status: DONE

---

# Phase 8 — Prototype Workbench

Goal

Create an interview-ready browser interface that demonstrates how the AI Decision Engine processes customer emails.

Implementation

- Static HTML
- CSS
- Vanilla JavaScript
- Served by the existing Express backend
- No React
- No Next.js
- No additional frontend framework

Features

- Custom email input
- Predefined demo scenarios
- Submit email to backend API
- Display detected intent
- Display extracted slots
- Display structured business facts
- Display retrieved policy evidence
- Display data sufficiency result
- Display business rule results
- Display final decision
- Display generated response
- Display audit trace
- Display LLM metadata
- Display token usage
- Display estimated cost
- Display latency

Deliverable

A lightweight prototype workbench that visualizes the complete reasoning pipeline.

Status: DONE

---

# Phase 9 — System Evaluation

Goal

Evaluate the quality, safety and reliability of the complete system.

Implementation

- Synthetic evaluation dataset
- Expected outputs
- Prompt evaluation
- Intent accuracy review
- Slot extraction review
- Decision accuracy review
- Hallucination detection
- Grounding verification
- Safe escalation verification
- Manual review checklist
- Cost analysis
- Latency analysis

Deliverable

An evaluation report demonstrating the behaviour, quality and limitations of the prototype.

Status: IMPLEMENTED — final stabilization pending review

---

# Production Considerations (Out of MVP Scope)

The implemented interview MVP ends with Phase 9. A production system would normally add
authentication and authorization, secrets and deployment hardening, CRM/ERP and ticketing
integration, persistent relational storage, a production vector database where justified,
monitoring and observability dashboards, a human-review queue, durable retry/dead-letter handling,
and evaluation datasets based on labelled production traffic. These are considerations, not a new
implementation phase.

# Completion Rules

A phase is complete only when:

- implementation is finished;
- code review is completed;
- issues are resolved;
- documentation is updated;
- changes are committed to Git.

Only then may the next phase begin.
