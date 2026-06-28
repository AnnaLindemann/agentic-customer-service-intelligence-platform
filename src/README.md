# `src/` — Application Source

This directory holds the application source. The structure mirrors the
processing pipeline described in [`docs/architecture.md`](../docs/architecture.md).

Phase 1 delivers a minimal runnable Express backend (`index.ts`) and validated
configuration (`config/`). Phase 2 adds the domain model and validation contracts
(`domain/`, `schemas/`, `types/`). Pipeline modules are added in later phases, in
roadmap order.

| Path        | Responsibility | Introduced in |
|-------------|----------------|---------------|
| `index.ts`  | Express app bootstrap; exposes `GET /health` | Phase 1 |
| `config/`   | Environment loading and validation (dotenv + Zod) | Phase 1 |
| `domain/`   | Domain enums (Intent, Workflow, Decision, RiskLevel, ReasonCode) | Phase 2 |
| `schemas/`  | Zod schemas — runtime validation contracts for each pipeline stage | Phase 2 |
| `types/`    | Core TypeScript types, inferred from `schemas/` | Phase 2 |
| `pipeline/` | One focused module per pipeline stage | Phase 3+ |

The dependency direction is one-way: `schemas/` import enum tuples from `domain/`, and
`types/` infer their TypeScript types from `schemas/`. Consumers import enums from
`domain/`, schemas from `schemas/`, and types from `types/`.

See [`docs/design-principles.md`](../docs/design-principles.md) for the rules that
govern what belongs where (notably: *LLMs interpret, rules decide*).
