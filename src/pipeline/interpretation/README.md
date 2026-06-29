# `src/pipeline/interpretation/` — LLM language understanding (Phase 6)

The front-of-pipeline LLM stages. Named after ADR-001 ("LLMs **interpret**. Rules decide.") and
symmetric with [`response/`](../response/) (language generation). They turn a **PII-masked**
email into validated structured meaning; they make no business decision and perform no scope
validation or workflow enrichment.

- **`prompts.ts`** — versioned prompt templates (`INTENT_PROMPT_VERSION`, `SLOT_PROMPT_VERSION`)
  and pure builders. Operate on masked text only; masked placeholders are preserved verbatim.
- **`intent-classification.ts`** — `classifyIntent()`: Intent Classification + Top-N Ranking
  (`IntentClassificationSchema`). Fail-safe → `unknown` (Decision Gate escalates).
- **`slot-extraction.ts`** — `extractSlots()`: Slot Extraction (`SlotExtractionSchema`).
  Fail-safe → empty slots, all requested fields marked missing.

Both depend only on the provider-neutral [`src/llm`](../../llm/) layer (no vendor SDK), output
structured JSON validated with Zod (one retry in the LLM layer), and never log prompt bodies.
Recognizable unmasked identifiers cause a safe fallback before client construction.
See ADR-012.
