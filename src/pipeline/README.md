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
