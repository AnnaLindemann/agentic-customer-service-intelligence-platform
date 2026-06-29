# Customer e-mail deterministic stages

This folder contains the deterministic Phase 3 stages that surround LLM interpretation:

- `pii-sanitizer.ts` masks contact details and business/customer identifiers and returns the
  sanitized text, detections and masking log.
- `scope-validation.ts` distinguishes supported, unknown and out-of-scope classifications.
- `workflow-enrichment.ts` maps only supported intents to predefined workflows and computes
  missing workflow fields.
- `case-state-builder.ts` assembles these validated outputs into the canonical `CaseState`.

The modules perform no I/O, make no LLM calls and do not make or bypass Decision Engine choices.
