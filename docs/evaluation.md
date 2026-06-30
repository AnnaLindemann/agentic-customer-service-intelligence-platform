# System Evaluation

Phase 9 evaluates the complete Phase 8 pipeline without changing it. The evaluation layer is an
offline consumer of `processEmail`; it never feeds a score back into classification, retrieval,
the deterministic Decision Engine, response generation, or compliance validation.

## Run

```bash
npm run evaluate:system
```

The command uses the configured provider and model, processes the versioned synthetic dataset at
`data/evaluation/system-evaluation.json`, and writes:

- `docs/evaluation-report.md` — the reviewable Phase 9 report;
- `artifacts/evaluation/latest.json` — machine-readable per-check results (git-ignored);
- `artifacts/evaluation/latest.md` — a generated copy of the report (git-ignored).

The command exits non-zero when any case fails all-of-case acceptance. A failing evaluation is a
quality signal, not a runtime routing input. Review the failed checks and the manual checklist
before changing a prompt, expected output, rule, or policy.

Cases run sequentially with a short fixed pause between them. This avoids an artificial provider
burst while leaving the production client's calls, timeout, retry policy, prompts, and results
unchanged.

## Dataset Contract

Every synthetic case contains the email, tags, fixed demo-clock setting, and curated expected:

- intent and workflow;
- extracted slot values and required missing slots;
- deterministic decision;
- escalation category, when a manual-review trigger is expected;
- whether a compliant draft must be delivered;
- exact LLM stage set (including the no-response-LLM guarantee for escalations);
- known synthetic PII values that must not appear in the passive audit record.

The dataset is validated with Zod before any provider call. Expected outputs are test labels, not
model-generated judgements.

## Metrics

Scoring is deterministic and separated by concern:

- prompt reliability: expected calls, prompt versions/fingerprints, schema-valid JSON, first-pass
  validity, and absence of response-generation calls on human/out-of-scope paths;
- exact-match intent and expected slot extraction;
- exact-match deterministic workflow and decision;
- hallucination safety: no high-risk or compliance-failed draft is delivered;
- grounding: every expected delivered draft passes compliance and cites retrieved evidence;
- safe escalation: explicit Human-by-Exception signals reach `HUMAN_ESCALATION`, while ordinary
  supported cases do not;
- audit PII exclusion for labelled values;
- provider-reported tokens, estimated cost, retry count, summed LLM latency, and end-to-end
  `processEmail` latency.

These automated checks do not establish semantic truth or production readiness. The generated
report includes a mandatory manual review checklist and states the dataset, retrieval-recall, and
run-to-run limitations.
