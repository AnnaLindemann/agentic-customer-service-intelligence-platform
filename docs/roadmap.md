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

---

# Phase 6 — Response Generation

- Response Generator
- Compliance Validation
- Structured JSON Output

---

# Phase 7 — Audit

- Audit Trace
- Prompt metadata
- Decision metadata
- Evaluation metrics

---

# Phase 8 — Prototype Workbench

Goal:

Create an interview-ready browser interface that demonstrates how the AI Decision Engine processes customer emails.

Implementation:

- Static HTML
- CSS
- Vanilla JavaScript
- Served by the existing Express backend
- No React
- No Next.js
- No additional frontend framework

Features:

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

Deliverable:

A lightweight prototype workbench that shows the full internal pipeline of the system in a clear visual format.

# Completion Rules

A phase is complete only when:

- implementation is finished;
- code review is completed;
- issues are resolved;
- documentation is updated;
- changes are committed to Git.

Only then may the next phase begin.
