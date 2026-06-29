# `src/pipeline/response/` — Response Generation (Phase 6)

Runs **after** the deterministic Decision Gate. It writes customer-facing text; it never makes
or changes a business decision (ADR-001, ADR-011).

- **`prompt.ts`** — versioned pure prompt builder. It converts evidence references to safe aliases,
  includes only per-kind whitelisted business fields, and exposes removed PII values for the
  deterministic leak check.
- **`response-generator.ts`** — `runResponseGeneration(input, llm?)`. For `HUMAN_ESCALATION` it
  makes **no LLM call**. Otherwise it generates a German draft (JSON, validated, one retry in the
  LLM layer), runs Compliance Validation, and delivers the draft only if it passes — else the
  safe fallback is no draft (human handling). The LLM client is injected for testability.
- **`compliance-validation.ts`** — deterministic gate: at least one cited ref exists, commitments
  have relevant policy/rule support, no raw PII leaks, the draft is conservatively identified as
  German, and it matches the unchanged Decision Gate result.

Output contract: `GeneratedResponseSchema` (`src/schemas/response.schema.ts`) — the phase's
Structured JSON Output. The full audit trace (Phase 7) is intentionally excluded.
The application does not yet expose an end-to-end customer-email API route.
