# `src/pipeline/decision/` — Decision Engine

The Decision Engine is Phase 5 of the [roadmap](../../../docs/roadmap.md). It is the part of
the pipeline where the system decides **what to do** with a case, after Retrieval has assembled
the evidence and before any response is drafted. It is fully **deterministic** — no LLM call —
because business decisions must be testable, repeatable and explainable (ADR-001:
*"LLMs interpret. Rules decide."*).

It combines three single-responsibility stages and returns one schema-validated bundle:

- **Data Sufficiency Evaluation** — is there enough evidence to answer *safely*? Checks that
  the workflow's required structured records and policy grounding are present (design
  principle 5: *no grounding means no answer*). It judges presence of evidence, not business
  eligibility.
- **Business Rule Engine** — applies the company's deterministic rules to the retrieved facts
  (e.g. *can this order still be cancelled?*). Returns one result per rule, passed **and**
  failed, so the audit trail can reconstruct exactly why an outcome occurred.
- **Decision Gate** — returns **exactly one** action — `AUTO_REPLY`,
  `ASK_FOR_MORE_INFORMATION`, `HUMAN_ESCALATION` or `OUT_OF_SCOPE` — from workflow scope, intent confidence,
  the sufficiency result and the rule results.

The engine **decides only**. It retrieves nothing and generates no customer-facing text
(that is Response Generation, Phase 6).

## Modules

| File | Responsibility |
|------|----------------|
| `data-sufficiency.ts` | Data Sufficiency Evaluation: is there enough evidence to answer safely? |
| `business-rules.ts` | Business Rule Engine: apply deterministic company rules to the facts. |
| `decision-gate.ts` | Decision Gate: pick exactly one action from all upstream signals. |
| `decision-engine.ts` | Compose the three stages into one `DecisionEngineResult` bundle. |
| `index.ts` | Barrel — the pipeline imports `runDecisionEngine` (and the sub-stages) from here. |

## Usage

```ts
import { runDecisionEngine } from './pipeline/decision';

const result = runDecisionEngine({
  caseId: 'case-123',
  workflow: 'cancellation',
  intent: 'cancellation_request',
  slots: { orderId: '10001' },
  missingInformation: [],            // required customer slots Workflow Enrichment found missing
  structuredFacts,                   // from Structured Data Retrieval
  policyEvidence,                    // from Semantic PDF Retrieval
  rankedIntents,                     // optional; enables the ambiguity check
});
// {
//   caseId,
//   evaluation:  { sufficient, reasonCode, missingInformation, hasStructuredData, hasPolicyEvidence },
//   ruleResults: [{ ruleId, passed, riskLevel, reasonCode, details }, ...],
//   decision:    { decision, riskLevel, reasonCode, rationale },
// }
```

The engine is synchronous. `now` can be injected for deterministic testing of time-based rules
(e.g. the cancellation window).

## Decision Gate ordering

The gate evaluates the most fundamental blocker first, so the reason code names the *first*
reason a case could not be auto-answered (`AUTO_REPLY` is the goal — ADR-007, *Human by
Exception*):

1. **Explicit legal/financial exception signal** → `HUMAN_ESCALATION`.
2. **Unknown or ambiguous intent** → `ASK_FOR_MORE_INFORMATION`.
3. **Understood out-of-scope request** → `OUT_OF_SCOPE` with deterministic redirect.
4. **Insufficient evidence** → ask when the customer can resolve the gap; escalate when policy
   grounding is unavailable.
5. **Blocking rule failure** → `HUMAN_ESCALATION`, including damage claims outside 30 days.
6. **Everything else safe** → `AUTO_REPLY`.

## Business rules

The thresholds mirror the prototype's approved policy documents and are isolated in
`business-rules.ts`:

| Workflow | Rules | Auto-reply when |
|----------|-------|-----------------|
| `cancellation` | `not_yet_shipped` (status `processing`), `within_window` (≤ 24h since placed) | both pass |
| `damaged_item` | `order_delivered`; blocking `within_claim_window` (≤ 30 days since delivery) | both pass; expired claims escalate |
| `invoice` | `answerable` (located invoice, any status) | passes |
| `product_availability` | `answerable` (product in catalogue) | always, once the product is found |

## Design notes

- **Why a separate sufficiency stage from rules?** Sufficiency asks *do we have the evidence?*;
  rules ask *does the evidence permit the action?* Keeping them apart means a missing order and a
  non-cancellable order produce different, accurately-routed outcomes (escalate vs. escalate
  with a rule reason; ask the customer vs. ask a human).
- **Why record passed rules too?** Explainability (design principle 4): the audit trail must be
  able to show *why an auto-reply was permitted*, not only why one was blocked.
- **Why deterministic?** Business decisions are safety-critical. Determinism makes them
  testable, repeatable, cheaper, lower-latency and impossible to hallucinate (ADR-001, ADR-005).
