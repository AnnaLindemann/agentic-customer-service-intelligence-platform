# `src/llm/` — Provider-neutral LLM layer

A ports-and-adapters boundary so the pipeline never depends on a vendor SDK.

- **`types.ts`** — the `LlmClient` port (`generateJson(req, schema)`), request/result types and
  `LlmError`. Every LLM call produces JSON validated against a Zod schema; nothing unvalidated
  crosses this boundary. The result and error also carry an optional `meta` (latency, retry count,
  provider request id, JSON-validation result) — **passive observability only**, consumed by the
  Phase 7 audit layer; it carries no behaviour and may be omitted by test doubles (ADR-013).
- **`client.ts`** — `createLlmClient()`: config-driven factory that selects the adapter from
  `LLM_PROVIDER`.
- **`providers/openai-compatible.ts`** — adapter built on the OpenAI SDK. Serves **Groq** (the
  prototype default) and **OpenAI** by base URL/key/model alone; retries once on invalid JSON,
  never logs prompt or completion bodies.

## Swapping provider

- **OpenAI** — change `LLM_PROVIDER`, `GROQ_BASE_URL`/key and `LLM_MODEL` (same adapter, since
  the API is OpenAI-compatible).
- **Anthropic** — add `providers/anthropic.ts` implementing `LlmClient` with `@anthropic-ai/sdk`
  and register it in `client.ts`. No pipeline stage changes.

Default model: `openai/gpt-oss-120b` via Groq; dev fallback `openai/gpt-oss-20b`. See ADR-011.
