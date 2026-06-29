# `src/pipeline/audit/` — Audit & Evaluation (Phase 7)

A **passive** observability layer. It records what happened during processing — LLM call
metadata, the decision, compliance outcomes and derived evaluation signals — and produces one
frontend-ready `AuditRecord`. It is deterministic and read-only.

Invariants (enforced by construction and tested in `src/tests/audit.test.ts`):

- It **never changes a decision** — every decision value is copied through verbatim.
- It **never blocks a response** — missing metadata degrades to safe defaults; recording errors
  are swallowed; unknown pricing yields `null`, never a throw.
- It **stores no raw prompt, completion or PII** — only counts, codes, statuses and a
  non-reversible prompt fingerprint.
- It is **provider-neutral** — Groq today, OpenAI/Anthropic later populate the same shape.

Files:

- **`pricing.ts`** — provider-independent price book (USD per 1M tokens) and
  `estimateCostUsd(model, inTok, outTok)`. Unknown model or missing tokens → `null`.
- **`llm-recorder.ts`** — `instrumentLlmClient(inner, recorder, { provider })` wraps any
  `LlmClient` and appends one `LlmAuditMetadata` per call (latency, retry count, tokens, cost,
  request id, prompt version + fingerprint, JSON validation result, error kind). Call behaviour
  is unchanged; the interpretation/response stages need no edits.
- **`evaluation-metrics.ts`** — `deriveEvaluationMetrics(decision, compliance)`: deterministic
  heuristics (hallucination/grounding/PII/escalation risk, overall safety). Indicators for the
  workbench, **not** authoritative quality measurement (that is Phase 9).
- **`audit-trace.ts`** — `buildAuditTrace(input)`: assembles the full `AuditRecord` from the
  stages' outputs (execution identity, LLM metadata + totals, decision metadata, compliance
  metadata, evaluation metrics, optional stage timeline).

Output contract: `AuditRecordSchema` (`src/schemas/audit.schema.ts`). The application does not
yet wire these into an end-to-end customer-email API route; Phase 8 will render the record.
