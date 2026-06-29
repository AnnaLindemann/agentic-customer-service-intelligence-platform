# `src/pipeline/` — Processing Pipeline Stages

Each pipeline stage is a single-responsibility module. Stages are implemented in
roadmap order (Phases 3–7), not in Phase 1.

The stages and their order are defined authoritatively in
[`docs/architecture.md`](../../docs/architecture.md):

```
PII Sanitizer → Intent Classification → Top-N Intent Ranking → Scope Validation →
Slot Extraction → Workflow Enrichment → Case State Builder → Structured Data Retrieval →
Semantic PDF Retrieval → Data Sufficiency Evaluation → Business Rule Engine →
Decision Gate → Response Generator → Compliance Validation → Audit Trace →
Structured JSON Output
```

The pipeline order is fixed by the architecture and must not be changed without an ADR.

## Implemented stages

| Stage | Module | Phase |
|-------|--------|-------|
| PII Sanitizer | [`customer-email/`](customer-email/) | Phase 3 repair |
| Scope Validation | [`customer-email/`](customer-email/) | Phase 3 repair |
| Workflow Enrichment | [`customer-email/`](customer-email/) | Phase 3 repair |
| Case State Builder | [`customer-email/`](customer-email/) | Phase 3 repair |
| Semantic PDF Retrieval | [`retrieval/`](retrieval/) | Phase 4 |
| Structured Data Retrieval | [`retrieval/`](retrieval/) | Phase 5 (Hybrid Retrieval Layer) |
| Hybrid Retrieval Layer (combines the two retrieval paths) | [`retrieval/`](retrieval/) | Phase 5 |
| Intent Classification | [`interpretation/`](interpretation/) | Phase 6 (LLM Integration) |
| Top-N Intent Ranking | [`interpretation/`](interpretation/) | Phase 6 (LLM Integration) |
| Slot Extraction | [`interpretation/`](interpretation/) | Phase 6 (LLM Integration) |
| Data Sufficiency Evaluation | [`decision/`](decision/) | Phase 5 (Decision Engine) |
| Business Rule Engine | [`decision/`](decision/) | Phase 5 (Decision Engine) |
| Decision Gate | [`decision/`](decision/) | Phase 5 (Decision Engine) |
| Response Generator | [`response/`](response/) | Phase 6 (LLM Integration) |
| Compliance Validation | [`response/`](response/) | Phase 6 (LLM Integration) |
| Structured JSON Output | [`response/`](response/) | Phase 6 (LLM Integration) |

The LLM stages (`interpretation/` and `response/`) depend only on the provider-neutral
[`src/llm`](../llm/) layer, never on a vendor SDK.

The deterministic Phase 3 stages live in [`customer-email/`](customer-email/). LLM entry points
also reject text containing recognizable unmasked identifiers, providing a fail-closed boundary
if a caller wires stages incorrectly.

These are composable pipeline modules. The application currently exposes only `/health`; an
end-to-end customer-email API route has not been implemented.
