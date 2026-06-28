# Engineering Workflow

## Purpose

This document defines how development work is performed in this project.

AI Coding Assistants may help with implementation, but they are not responsible for architecture.

The architecture is controlled by the project owner and reviewed before implementation.

---

## Development Cycle

Every phase follows the same cycle:

1. Read the current roadmap phase.
2. Read `docs/architecture.md`.
3. Read this workflow document.
4. Implement only the requested phase.
5. Do not modify unrelated modules.
6. Do not introduce additional abstractions without explanation.
7. Keep code simple and readable.
8. Explain important design decisions.
9. Wait for review before continuing.
10. Commit only after review.

---

## Implementation Rules

AI Coding Assistants must:

- write production-quality TypeScript;
- prefer readability over cleverness;
- keep modules focused on one responsibility;
- validate all LLM outputs with Zod;
- never bypass deterministic business logic;
- never change pipeline order without approval;
- never modify roadmap without explicit instruction.

---

## Architectural Principle

> LLMs interpret. Rules decide.

LLMs may classify, extract, summarize and generate text.

Rules decide business actions.

The full set of principles is defined in [design-principles.md](design-principles.md),
which is the single source of truth.

---

## Phase Completion

Every phase must finish with:

- implementation summary;
- files created;
- files modified;
- known limitations;
- suggested improvements;
- explicit request for human review.

## Development Environment Strategy

Development is performed locally.

GitHub is the single source of truth.

Oracle Cloud is used as the target deployment and validation environment.

After every major completed phase:

1. Push changes to GitHub.
2. Pull changes on Oracle.
3. Build and validate the project.
4. Fix deployment issues before starting the next phase.

The next phase starts only after approval.