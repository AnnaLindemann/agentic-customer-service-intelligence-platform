# `src/` — Application Source

This directory holds the application source. The structure mirrors the
processing pipeline described in [`docs/architecture.md`](../docs/architecture.md).

Phase 1 delivers a minimal runnable Express backend (`index.ts`) and validated
configuration (`config/`). Pipeline modules and shared schemas are added in later
phases, in roadmap order.

| Path        | Responsibility | Introduced in |
|-------------|----------------|---------------|
| `index.ts`  | Express app bootstrap; exposes `GET /health` | Phase 1 |
| `config/`   | Environment loading and validation (dotenv + Zod) | Phase 1 |
| `types/`    | Shared types and Zod schemas for validated data | Phase 2 |
| `pipeline/` | One focused module per pipeline stage | Phase 3+ |

See [`docs/design-principles.md`](../docs/design-principles.md) for the rules that
govern what belongs where (notably: *LLMs interpret, rules decide*).
