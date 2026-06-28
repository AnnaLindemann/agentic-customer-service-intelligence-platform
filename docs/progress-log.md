# Progress Log

A chronological record of completed work, phase by phase. Each entry is added when
a roadmap phase is implemented and submitted for review.

---

## Phase 2 — Domain Model & Validation Contracts

**Date:** 2026-06-28
**Status:** Implemented — awaiting review

### Scope

The domain-model and Zod-validation slice of the roadmap's Phase 2 (Core Infrastructure):
the internal domain vocabulary and the runtime validation contracts that later pipeline
stages will produce and consume. The Express API portion of Phase 2 is intentionally
deferred. No business logic, retrieval, LLM calls, API endpoints or pipeline execution
are included.

### Completed

- **`src/domain/`** — enums as the single source of vocabulary: `Intent`, `Workflow`,
  `Decision`, `RiskLevel`, `ReasonCode`. Each is a frozen const object plus a union type
  plus a value tuple (e.g. `INTENTS`) used to seed Zod enums. No Zod dependency here.
- **`src/schemas/`** — one focused Zod schema module per contract:
  `IntentClassificationSchema`, `SlotExtractionSchema`, `PDFRetrievalSchema`,
  `BusinessRuleResultSchema`, `DecisionSchema`, `CaseStateSchema`,
  `FinalApiResponseSchema`, plus the supporting sub-schemas they compose from
  (PII, ranked intent, slots, retrieved/structured source, evaluation, audit).
- **`src/types/`** — every core type (`CaseState`, `RetrievedSource`,
  `EvaluationSummary`, `AuditTrace`, `DetectedPII`, `MaskingLogEntry`, `RankedIntent`,
  `ExtractedSlots`, `StructuredSource`, `BusinessRuleResult`, …) inferred from its schema
  via `z.infer`, so runtime and compile-time contracts cannot drift. Enum types are
  re-exported here for a single type surface.
- Barrels (`index.ts`) for `domain/`, `schemas/` and `types/` give later modules stable
  import paths.

### Verification

- `npm run build` compiles cleanly (TypeScript strict).
- Runtime smoke check: enum tuples populate (6 intents, 3 decisions, 11 reason codes);
  a valid `IntentClassificationSchema` payload parses; an invalid intent is rejected;
  `FinalApiResponseSchema` parses and applies array defaults.

### Notes

- `DecisionSchema`'s inferred object type is exported as `DecisionResult` to avoid a name
  clash with the `Decision` enum value/type.
- All ten requested core types are schema-backed and inferred rather than hand-written,
  to honour "prefer Zod schemas as the source of runtime validation" and to keep a single
  source of truth.

---

## Phase 1 — Foundation

**Date:** 2026-06-28
**Status:** Implemented — awaiting review

### Scope

Repository setup, documentation, project structure, and a development environment that
yields a **runnable Express backend** exposing `GET /health`, runnable both locally and
via Docker. Per the roadmap this phase configures TypeScript and Express and installs
Zod and dotenv. No pipeline modules or business logic are included; Phase 2 is not started.

### Completed

- **Development environment & toolchain**
  - `package.json` with runtime deps (`express`, `zod`, `dotenv`) and dev deps
    (`typescript`, `@types/express`, `@types/node`). Node `>=20`, private.
  - `tsconfig.json` — minimal strict config; CommonJS output to `dist/` from `src/`.
  - Pinned Node version with `.nvmrc`.
- **Runnable backend**
  - `src/index.ts` — Express app bootstrap exposing `GET /health` → `200 {"status":"ok"}`.
    No other routes.
  - `src/config/env.ts` — loads `.env` via dotenv and validates `NODE_ENV`/`PORT` with Zod;
    exits non-zero on invalid configuration.
- **Docker support**
  - `docker/Dockerfile` — builds the TypeScript app and runs `node dist/index.js`.
  - `docker/docker-compose.yml` — builds/runs the service on port 3000 with a `/health`
    healthcheck.
  - `.dockerignore`.
- **Project structure**
  - `src/` (`config/`, `types/`, `pipeline/`) and `data/` (`business/`, `policies/`)
    skeletons with READMEs mapped to the architecture; `tests/` placeholder.
- **Repository setup & documentation**
  - `.github/pull_request_template.md` reflecting the engineering-workflow checklist.
  - This progress log; README documentation table updated.

### Verification

- `npm install` succeeds; `package-lock.json` committed.
- `npm run build` compiles cleanly with no errors (TypeScript strict).
- App starts: `node dist/index.js` logs `Server listening on port <PORT>`.
- `GET /health` returns **HTTP 200** with body `{"status":"ok"}` (verified on default
  port 3000 and on a custom `PORT=4100`). Unknown routes return 404.
- Docker: not validated in the current environment — the Docker CLI is unavailable in
  this WSL distro. The `Dockerfile`/`compose` files are standard and ready to build where
  Docker is available.

### Notes

- The roadmap Phase 1 status is intentionally left as "In Progress"; it is marked
  complete only after human review and commit, per the roadmap completion rules.
- An earlier draft of this entry deferred TypeScript/Express/Zod/dotenv to Phase 2;
  that was corrected to match the roadmap, which places them in Phase 1.
