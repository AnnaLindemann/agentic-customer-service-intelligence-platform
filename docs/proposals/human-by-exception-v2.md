# Design Proposal — Human by Exception v2

> Historical proposal. ADR-014 and the current implementation are authoritative. Final
> stabilization added the blocking 30-day damaged-item exception and removed wording that implied
> external operational actions were executed.

**Status:** Draft for review (no code changed, no ADR committed)
**Author:** prepared for the project owner's review
**Scope:** evolve the prototype from an *AI Email Router* into an *AI Customer Operations Platform* without altering the existing architecture (deterministic rules, explainability, auditability, observability, provider abstraction, fixed pipeline order).

This document contains the seven deliverables requested:
1. ADR-014 draft
2. Updated decision philosophy (decision matrix)
3. Per-workflow review
4. Customer-guidance standard
5. Escalation philosophy
6. Demo review
7. Implementation plan

---

## 0. Problem statement

ADR-007 already declares *"Human by Exception"*: `AUTO_REPLY` is the goal, escalation the fallback. The **implementation does not live up to the ADR**. The Decision Gate (`src/pipeline/decision/decision-gate.ts`) escalates on the *absence of a happy path* rather than on the *presence of a real exception*:

- **Any failed business rule → `HUMAN_ESCALATION`** (`decision-gate.ts:135-143`).
- **A record that does not resolve → `HUMAN_ESCALATION`** (`STRUCTURED_DATA_MISSING`, `decision-gate.ts:126-131`).
- **`UNKNOWN`/ambiguous intent → `HUMAN_ESCALATION`** (`decision-gate.ts:95-112`), with no clarifying question first.

Observable symptom: demo scenario 5 (cancel order `10001`) escalates today, because `10001` is `processing` but was placed `2026-06-28T09:15Z` and "today" is `2026-06-29` — past the 24h window → `cancellation.within_window` fails → conflict → escalation. A core "happy-path" demo escalates.

The redesign keeps the safety net but makes it **precise**: escalate on explicit exception signals, not on every non-happy path.

---

## 1. ADR-014 Draft — Human by Exception v2

> *Draft only. Not to be appended to `docs/decisions.md` until approved.*

### Title
Human by Exception v2 — escalate on exception signals, not on the absence of a happy path.

### Status
Proposed (supersedes the *interpretation* of ADR-007; ADR-007 itself remains accepted).

### Context
ADR-007 set the goal of maximum safe automation but left the Decision Gate mapping every
non-ideal branch to a human: failed business rules, unresolved records and low-confidence
intents all escalate. In an enterprise Customer Operations platform this is the wrong default.
Most "negative" outcomes (an order can no longer be cancelled, an invoice was refunded, an
item arrived damaged) are **informational or intake** interactions that are fully grounded in
policy and business data and require **no human judgement**. Treating them as escalations
inflates the human queue, hides the system's real capability, and — for an interview prototype —
demonstrates "Human by Default" rather than "Human by Exception."

The current model also lacks the one thing that makes aggressive automation *safe*: a
deterministic detector for the cases policy **explicitly** reserves for humans (disputes,
chargebacks, goodwill/Kulanz, fraud, legal). Because those signals are not detected, the system
compensates by escalating broadly. Adding an explicit trigger lets us relax everything else.

### Decision
Adopt **Human by Exception v2**, built on three ideas:

1. **Classify each workflow by the kind of decision it is**, not by a uniform rule gate:
   - *Informational* (product availability, invoice questions) — answer from data + policy.
   - *Intake* (damaged item) — acknowledge, explain policy, request evidence, open a simulated
     case, state next steps. Never a gate to a human.
   - *Action / mutating* (cancellation) — the only workflow where a rule truly gates an action;
     even then an ineligible result becomes a grounded explanation, not a handoff.

2. **Add a deterministic Escalation-Trigger guard** that scans the masked email for the signals
   policy reserves for manual review (dispute, chargeback, goodwill, fraud, legal,
   dispute-of-prior-decision). This becomes the *precise* safety net.

3. **Re-order the Decision Gate** so that failed eligibility rules shape the *message* rather than
   forcing escalation, unresolved records and ambiguous intent become
   `ASK_FOR_MORE_INFORMATION`, and only genuine exception signals / unsupported scope reach a human.

### Why this better reflects enterprise AI systems
- Enterprise CS platforms (Zendesk AI, Intercom Fin, Salesforce Agentforce) resolve the large
  majority of contacts end-to-end and route only true exceptions to agents. Deflection rate is
  the headline metric; broad escalation is a failure mode, not a safety feature.
- Safety comes from **grounding + explicit exception detection**, not from refusing to answer.
  Explaining a policy-grounded "no" is safe; inventing a "yes" is not. The compliance gate already
  enforces grounding.

### Architectural changes proposed
- New deterministic stage `escalation-triggers` (sits in the customer-email/decision boundary).
- New deterministic helper `case-intake` to mint simulated case references (RMA/cancellation IDs).
- Re-classify three business rules from *blocking* to *informational*.
- Re-order and re-target the Decision Gate branches.
- Extend the response prompt to carry the grounded reason + simulated case reference, and to make
  an LLM draft for the new auto-explained outcomes.

### What does NOT change
- **ADR-001** "LLMs interpret. Rules decide." — all decisions stay deterministic; the LLM still
  only writes text.
- **Pipeline order** (`docs/architecture.md`, `process-email.ts`) — stages stay in the same order;
  the new guard slots into the existing decision boundary.
- **PII posture (ADR-004)**, **provider abstraction (ADR-011)**, **passive audit (ADR-013)**,
  **hybrid retrieval (ADR-009)** — untouched.
- **Schemas / domain enums** — `Decision`, `Workflow`, `RiskLevel` unchanged; at most additive
  `ReasonCode` values.
- The compliance gate remains deterministic and fail-safe (no draft on doubt).

### Consequences
- **Advantages:** automation rate rises sharply; escalations become meaningful; the demo proves
  the thesis; the safety net is precise and auditable.
- **Trade-offs:** more deterministic branches and message templates to maintain; the
  escalation-trigger lexicon needs tuning; "negative" auto-replies must be carefully grounded so
  compliance does not flag them.

---

## 2. Updated Decision Philosophy — Decision Matrix

Legend: **AR** = `AUTO_REPLY`, **ASK** = `ASK_FOR_MORE_INFORMATION`, **ESC** = `HUMAN_ESCALATION`.

| Workflow | Situation | Outcome | Business justification |
|---|---|---|---|
| **Cancellation** | Order found, eligible (processing + within 24h) | **AR** — confirm simulated cancellation | Policy §2.1 permits it; deterministic check passed; no judgement needed. |
| Cancellation | Order found, ineligible (shipped/delivered/cancelled/past window) | **AR** — explain why + offer return path | Policy §2.2/§4 fully covers this; explaining a grounded "no" is safe and self-serve. |
| Cancellation | No order number supplied | **ASK** — request order number | Customer can self-serve the missing slot. |
| Cancellation | Order number supplied but not found | **ASK** — ask to confirm number | A typo should not consume an agent. |
| Cancellation | Customer disputes/insists/goodwill | **ESC** | Policy reserves goodwill/disputes for humans. |
| **Damaged item** | Order delivered + description present | **AR** — acknowledge, policy, open case, next steps | Intake, not a decision; grounded in damage policy §3. |
| Damaged item | High-value line (≥150 USD) without photo | **ASK** — request photo + open provisional case | Policy §3.2 requires a photo before approval; asking is the correct step. |
| Damaged item | Missing description | **ASK** — request description (+ photo if high-value) | Customer supplies evidence; no human needed. |
| Damaged item | Order not delivered / not found | **ASK** — confirm order + delivery details | Reconcilable by the customer; intake continues. |
| Damaged item | Dispute of prior decision / fraud / legal | **ESC** | Explicit manual-review categories. |
| **Invoice** | Invoice/order found, any status (incl. refunded/voided/overdue) | **AR** — explain status, amounts, dates + policy | Billing §5 answers every status from the record; reporting facts is the safest automation. |
| Invoice | No invoice/order id supplied | **ASK** — request identifier | Self-serve slot. |
| Invoice | Id supplied but not found | **ASK** — ask to confirm | Typo, not an exception. |
| Invoice | Dispute / chargeback / goodwill adjustment | **ESC** | Billing §8 reserves these for humans. |
| **Product availability** | Product found | **AR** — report availability/stock/restock | Already correct; answered from inventory. |
| Product availability | Product not found / not in catalogue | **ASK** — ask to confirm product name | Likely a naming mismatch; let the customer clarify. |
| **Cross-cutting** | Out-of-scope / unsupported intent | **ESC** | Genuinely unsupported (e.g. route advice, B2B, legal). |
| Cross-cutting | Unknown / ambiguous intent | **ASK** — one clarifying question | Cheaper and more "by exception" than a handoff. |
| Cross-cutting | Explicit exception signal (any workflow) | **ESC** | Policy explicitly requires manual review. |

---

## 3. Per-Workflow Review

### 3.1 Cancellation *(action / mutating)*
- **Fully automated:** confirming an eligible cancellation (simulated), **and** explaining an
  ineligible one with the policy-grounded reason and the return-after-delivery alternative.
- **Becomes ASK:** missing order number; order number supplied but unresolved.
- **Must remain ESC:** customer disputes the outcome, insists on an exception, or requests
  goodwill/Kulanz; suspected fraud.
- **Why:** the only genuine human judgement is a goodwill exception. Eligibility and ineligibility
  are both fully determined by policy §2 and business data, so both are safe to automate.

### 3.2 Damaged Item *(intake)*
- **Fully automated:** acknowledge the issue, explain the damage policy (§3), open a simulated
  return/replacement case with a reference, state what happens after evidence review.
- **Becomes ASK:** missing damage description; high-value item without a photo (policy §3.2);
  order not delivered or not found (confirm details) — the intake continues, it does not stop.
- **Must remain ESC:** disputing a previous damage decision, suspected fraud, legal complaint,
  or a claim outside the 30-day window combined with a dispute.
- **Why:** opening a case and requesting evidence is administrative intake, explicitly "no human
  decision at this stage." A human only enters when judgement or policy exception is required.

### 3.3 Invoice Questions *(informational)*
- **Fully automated:** every locatable invoice, **all statuses** — report status, amount due,
  paid/refund dates, and the relevant billing policy. This includes `refunded` and `voided`
  (today these escalate).
- **Becomes ASK:** no identifier supplied, or an identifier that does not resolve.
- **Must remain ESC:** billing **disputes**, **chargebacks**, **goodwill adjustments** (billing §8).
- **Why:** reporting stored invoice facts is the single most automatable interaction; only an
  actual money dispute needs Finance.

### 3.4 Product Availability *(informational)*
- **Fully automated:** all in-catalogue products (unchanged).
- **Becomes ASK:** product not found — likely a naming/spelling mismatch; ask to confirm.
- **Must remain ESC:** none specific to this workflow (cross-cutting triggers still apply).
- **Why:** availability is pure inventory reporting; the only failure mode is product identification,
  which the customer can resolve.

---

## 4. Customer Guidance Standard

Every outcome must **guide the customer** with a consistent four-part structure. The Response
Generator already writes German `Sie`-form; we standardise the *content contract* it must satisfy
per decision. Each draft answers, in order:

1. **What happened** — the outcome in plain language.
2. **Why** — grounded in a cited policy passage and/or business fact.
3. **What happens next** — the system's next action (case opened, review timeline, etc.).
4. **What the customer should do** — the concrete next step, or "nothing further is needed."

**AUTO_REPLY**
- *What:* state the resolution ("Ihre Bestellung wurde storniert" / "Ihre Rechnung … ist bezahlt").
- *Why:* cite the policy/fact that grounds it.
- *Next:* confirm the system action and any reference (e.g. simulated cancellation/RMA id, refund
  timeline 5–10 business days per billing §6.2).
- *Do:* usually "nichts weiter erforderlich," or the alternative path for an ineligible action.

**ASK_FOR_MORE_INFORMATION**
- *What:* acknowledge the request and that we have started on it.
- *Why:* name exactly the missing item and why it is needed (e.g. photo required for high-value
  claims per §3.2).
- *Next:* state that the case is on hold / provisionally opened pending the information.
- *Do:* the precise thing to send (order number, photo, description).

**HUMAN_ESCALATION**
- *What:* acknowledge and say a specialist will take over.
- *Why:* a neutral, non-committal reason ("Ihr Anliegen erfordert eine individuelle Prüfung") —
  never promise an outcome (customer-service §6).
- *Next:* a human agent will follow up; give the case reference and a realistic timeframe.
- *Do:* nothing further needed, or "halten Sie Ihre Unterlagen bereit."

This standard is enforced by the prompt (content requirements) and remains within the existing
deterministic compliance gate (no invented facts, must cite a reference).

---

## 5. Escalation Philosophy

**Principle:** escalate on *explicit exception signals* or *genuine impossibility*, never on the
*absence of a happy path*.

### Should become AUTO_REPLY (today they escalate)
| Today | New | Code locus |
|---|---|---|
| Cancellation ineligible (shipped/delivered/past window) | **AR** (explain + return path) | `business-rules.ts:104-124` → gate `:135` |
| Invoice refunded/voided | **AR** (report status from record) | `business-rules.ts:165-175` → gate `:135` |
| Damaged item, order not delivered | **AR/ASK** (intake continues) | `business-rules.ts:140-150` → gate `:135` |

### Should become ASK_FOR_MORE_INFORMATION (today they escalate)
| Today | New | Code locus |
|---|---|---|
| Record id supplied but unresolved | **ASK** (confirm id) | `data-sufficiency.ts:81` → gate `:126` |
| Unknown / ambiguous intent | **ASK** (one clarifying question) | `decision-gate.ts:95,105` |
| Missing policy passage (semantic miss) | **ASK/AR** with per-workflow policy fallback | `data-sufficiency.ts:82` → gate `:126` |

### Must remain HUMAN_ESCALATION
1. **Out-of-scope / unsupported workflow** — genuinely cannot be handled.
2. **Explicit disputes / chargebacks / goodwill (Kulanz)** — customer-service §5, billing §8.
3. **Suspected fraud or legal complaints** — policy and risk require a human.
4. **Dispute of a prior decision** ("you already refused, I insist").
5. **Record still unresolved after we have asked** — escalation boundary in a single-shot prototype.

> ⚠️ **Prerequisite for safety:** items 2–4 are **not detected today** (no intent/guard exists). The
> new deterministic **Escalation-Trigger guard** must land *with* the relaxations, or we would
> silently auto-reply to cases policy reserves for humans.

---

## 6. Demo Review

### Current scenarios (`public/app.js`)
1. Product availability → AR ✅
2. Invoice (paid) → AR ✅
3. Damaged item, delivered → AR ✅
4. Cancellation, missing order number → ASK ✅
5. Cancellation, order on file → **escalates today** (past 24h window) ❌ misleading
6. Out of scope → ESC ✅

Problems: only one ASK, no example of automated *ineligibility* handling, no example of the system
*correctly* escalating a true exception, and scenario 5 accidentally demonstrates over-escalation.

### Proposed scenario set (8) — ordered to tell the "Human by Exception" story
1. **Product availability → AUTO_REPLY** (keep) — baseline automation.
2. **Invoice paid → AUTO_REPLY** (keep) — informational automation.
3. **Invoice refunded → AUTO_REPLY** (new) — shows *all statuses* are answered, not escalated.
4. **Cancellation eligible → AUTO_REPLY** (order `10004`/`10010`, processing & recent) — auto-confirm + simulated id.
5. **Cancellation already shipped → AUTO_REPLY** (order `10002`) — explains policy + return path, no human.
6. **Damaged high-value item, no photo → ASK** — requests photo, opens provisional case (intake).
7. **Order number not found → ASK** — asks to confirm, instead of escalating.
8. **Goodwill / dispute → HUMAN_ESCALATION** — e.g. "Ich bestehe auf einer Ausnahme/Kulanz" — proves the system still escalates true exceptions.

Result the interviewer sees: **6 automated (AR/ASK), 2 of which are clarifications, 1 genuine human
exception** — a concrete demonstration that the platform handles the vast majority automatically.

> Note: scenario data must be picked so the live statuses produce the intended outcome. Verify
> `placedAt` against the demo "now" for eligible-cancellation cases, or freeze the clock for the demo.

---

## 7. Implementation Plan (no code yet)

Ordered in two slices so the behavior change can be reviewed before the polish.

### Slice A — core behavior change

**A1. Escalation-Trigger guard** *(new module)*
- **Module:** `src/pipeline/decision/escalation-triggers.ts` (deterministic, synchronous).
- **Behavior:** scan the masked email for DE/EN markers — dispute (`Widerspruch`, `ich bestehe`,
  `dispute`), chargeback (`Rückbuchung`, `chargeback`), goodwill (`Kulanz`, `goodwill`), fraud
  (`Betrug`, `fraud`), legal (`Anwalt`, `rechtliche`, `lawyer`). Returns a typed signal + matched
  category for the audit trail.
- **Wiring:** consumed by the Decision Gate as the highest-priority supported-scope check.
- **Prompts:** none.
- **Rules:** none.
- **Docs/ADR:** covered by ADR-014.

**A2. Re-classify business rules** *(modify)*
- **Module:** `src/pipeline/decision/business-rules.ts`.
- **Change:** introduce a rule semantic distinction — `blocks_automation` vs `informational`.
  Reclassify `cancellation.*` (ineligible), `damaged_item.order_delivered`, `invoice.answerable`
  from hard failures to *informational* outcomes that carry a grounded reason but do **not** force
  escalation. Keep `recordMissing` results as ASK-eligible signals, not escalations.
- **Prompts:** none directly.
- **Demo:** enables scenarios 3, 5.
- **Docs/ADR:** ADR-014; update the threshold note already in `business-rules.ts:16-18`.

**A3. Re-order / re-target the Decision Gate** *(modify)*
- **Module:** `src/pipeline/decision/decision-gate.ts`.
- **New order:** (1) escalation-trigger → ESC; (2) out-of-scope/unsupported → ESC;
  (3) unknown/ambiguous → ASK; (4) missing customer slot → ASK; (5) record unresolved (id given)
  → ASK; (6) informational rule results → AR with grounded reason; (7) → AR.
- **Inputs:** gate now also receives the escalation-trigger signal and the unresolved-vs-missing
  distinction.
- **Prompts:** none.
- **Docs/ADR:** ADR-014 (the module header documents the ordering rationale and must be updated).

**A4. Data-sufficiency adjustment** *(modify)*
- **Module:** `src/pipeline/decision/data-sufficiency.ts`.
- **Change:** when a required record is missing *because an id was supplied but unresolved*, signal
  an **ASK** path (confirm id) rather than `STRUCTURED_DATA_MISSING`-as-escalation. Optionally make
  `policy_evidence` non-blocking with a deterministic per-workflow policy fallback so a semantic
  miss cannot force a human.
- **Schema:** possibly one additive `ReasonCode` (e.g. `RECORD_UNRESOLVED`); confirm against
  `src/domain/enums.ts` before adding (ADR-006 governs the enum).

### Slice B — guidance, simulated cases, prompts, demo

**B1. Simulated case intake** *(new module)*
- **Module:** `src/pipeline/decision/case-intake.ts` (deterministic).
- **Behavior:** mint a stable, non-PII reference (e.g. `RMA-2026-NNNN`, `CXL-2026-NNNN`) for
  intake/cancellation outcomes; surfaced in the response and recorded in the audit stage timeline.
- **Audit:** add a stage record entry (no PII).

**B2. Response prompt + generator** *(modify)*
- **Modules:** `src/pipeline/response/prompt.ts`, `src/pipeline/response/response-generator.ts`.
- **Changes:**
  - Pass the **grounded reason** (relevant informational rule details + policy passage) and the
    **simulated case reference** into the prompt — today only *passed* rules are sent
    (`prompt.ts:207`).
  - Generate an LLM draft for the new auto-explained outcomes (ineligible cancellation, refunded
    invoice, damaged intake) — today `HUMAN_ESCALATION` makes no LLM call; ensure these now route as
    AR/ASK and therefore *do* draft.
  - Encode the **four-part customer-guidance contract** (§4) in `SYSTEM_PROMPT`.
- **Prompt version:** bump `RESPONSE_PROMPT_VERSION` (carried into the Phase 7 audit).

**B3. Compliance validation** *(modify / verify)*
- **Module:** `src/pipeline/response/compliance-validation.ts`.
- **Change:** ensure an AUTO_REPLY grounded in a policy passage + informational rule (no "passed"
  rule) is not flagged as an *unsupported promise*; keep the German-language, PII-leak and
  decision-match checks intact. Fail-safe behavior unchanged.

**B4. Demo scenarios** *(modify)*
- **Module:** `public/app.js` (`SCENARIOS`).
- **Change:** replace with the 8-scenario set in §6; verify each against live business data and the
  demo clock.

**B5. Documentation**
- **Append ADR-014** to `docs/decisions.md` (from §1, once approved).
- Update `docs/architecture.md` if the escalation-trigger stage is added to the documented order.
- Update module headers in `decision-gate.ts` / `business-rules.ts` to reflect v2.
- Optionally a short note in `docs/design-principles.md`.

### Cross-cutting guarantees preserved
- No change to pipeline order, PII masking, provider abstraction, or the passive audit layer.
- All decisions remain deterministic; the LLM still only writes text.
- Schema/enum changes are additive only and gated on review (ADR-006).

---

## Open questions for the reviewer
1. **Eligible-cancellation as AUTO_REPLY confirming a (simulated) mutation** — acceptable for the
   prototype, or should an eligible cancellation be ASK ("confirm you want to cancel") first?
2. **Escalation-trigger lexicon** — German-first only, or DE+EN as drafted?
3. **Policy fallback** — should a semantic-retrieval miss fall back to a hard-coded policy section
   per workflow, or remain an ASK?
4. **Scope of Slice A vs B** — implement A (behavior) first and review before B (guidance/demo)?
</content>
</invoke>
