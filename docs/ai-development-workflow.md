# AI Development Workflow

## Purpose

This document defines how AI Coding Assistants work in this repository.

The goal is to ensure predictable engineering decisions, architectural consistency and high-quality code.

---

# Roles

## Human

Responsible for:

- architecture
- roadmap
- design decisions
- final approval

---

## AI Coding Assistant

Responsible for:

- implementation
- refactoring
- code generation
- explaining technical decisions

AI assistants never own the architecture.

---

# Required Reading Order

Before starting any implementation, always read:

1. README.md
2. docs/design-principles.md
3. docs/architecture.md
4. docs/roadmap.md (current phase only)
5. docs/engineering-workflow.md

Do not read unnecessary documentation.

---

# Development Rules

Always:

- implement only the current roadmap phase;
- follow the existing architecture;
- ask before introducing new technologies;
- keep changes minimal;
- preserve existing APIs unless instructed otherwise.

Never:

- redesign the architecture;
- change the roadmap;
- introduce unnecessary abstractions;
- optimize prematurely;
- add features outside the current phase.

---

# LLM Usage Principle

> LLMs interpret. Rules decide.

The full set of principles is defined in [design-principles.md](design-principles.md),
which is the single source of truth. Read it before implementing.

Use LLMs only for:

- language understanding;
- intent classification;
- slot extraction;
- draft generation.

Use deterministic code for:

- validation;
- business rules;
- workflow routing;
- security;
- compliance;
- data lookup;
- audit logging.

---

# Code Quality

Generated code must:

- be readable;
- follow SOLID where appropriate;
- avoid over-engineering;
- include meaningful names;
- handle errors explicitly.

---

# Implementation Output

After every implementation provide:

## Summary

Short explanation of what was implemented.

## Files Changed

List of modified files.

## Design Decisions

Explain non-obvious decisions.

## Risks

Mention limitations or technical debt.

## Review

Wait for human review before continuing.

No phase may continue without approval.