# Architecture Decision Records (ADR)

This document records important architectural decisions made during the project.

Every significant change must be documented here.

---

# ADR-001

## Title

LLMs interpret. Rules decide.

## Status

Accepted

## Context

The system processes customer emails that may affect business decisions.

LLMs provide strong language understanding but should not be trusted with business-critical decisions.

## Decision

Use LLMs only for language-related tasks:

- intent classification
- top-N intent ranking
- slot extraction
- draft response generation

Business-critical logic remains deterministic.

## Consequences

Advantages:

- safer system
- explainable decisions
- easier testing
- lower hallucination risk

Trade-off:

- more deterministic code must be implemented.

---

# ADR-002

## Title

Hybrid Retrieval

## Status

Accepted

## Context

The interview task requires retrieving information from both structured business data and PDF documents.

## Decision

Use two retrieval mechanisms:

- deterministic JSON lookup
- lightweight semantic PDF retrieval

## Consequences

Advantages:

- grounded responses
- realistic enterprise architecture
- lightweight infrastructure

Trade-off:

- additional retrieval pipeline.

---

# ADR-003

## Title

Local Infrastructure for MVP

## Status

Accepted

## Context

The prototype targets Oracle Cloud Always Free.

Infrastructure must remain lightweight.

## Decision

Use:

- local JSON business data
- local vector index
- Docker
- no PostgreSQL
- no external vector database

## Consequences

Advantages:

- low resource usage
- simple deployment
- interview-friendly architecture

Trade-off:

- limited scalability.

---

# ADR-004

## Title

PII masking must always happen before any LLM call.

## Status

Accepted

## Context

Customer emails contain personal data (names, addresses, emails, order details).
LLM calls may be processed by an external API, so raw PII must never leave the system
in a prompt.

## Decision

The PII Sanitizer is the first stage of the pipeline and runs deterministically before any
LLM-powered stage (Intent Classification, Slot Extraction, Response Generator). No stage may
send unmasked personal data to an LLM.

## Consequences

Advantages:

- personal data is protected before any external processing
- privacy guarantee is deterministic and auditable
- compliance posture is stronger by construction

Trade-off:

- downstream stages operate on masked text and must reconcile masked tokens with
  structured data retrieved deterministically.

---

# ADR-005

## Title

Responsibility boundaries do not imply LLM-based agents.

## Status

Accepted

## Context

The task is framed around agent-like responsibilities (customer identification, retrieval,
rule validation, escalation). A naive reading would implement each responsibility as an
autonomous LLM agent. That increases cost, latency and hallucination risk, and weakens
auditability.

## Decision

A responsibility boundary is a unit of accountability, not a mandatory LLM call. Each
responsibility is implemented as a deterministic module whenever deterministic code can
achieve acceptable quality. LLMs are used only for language understanding and language
generation (Intent Classification, Top-N Intent Ranking, Slot Extraction, Response Generator).

Deterministic implementations are preferred because they are testable, repeatable,
explainable via reason codes, cheaper, lower-latency, and cannot hallucinate business
decisions. See [design-principles.md](design-principles.md).

## Consequences

Advantages:

- fewer LLM calls; lower cost and latency
- stronger auditability and safety
- most pipeline stages are deterministic and unit-testable

Trade-off:

- more deterministic code must be written and maintained.

---

# ADR-006

## Title

Phase 2 establishes the canonical domain enum values.

## Status

Accepted

## Context

Early documentation (the architecture worked example) used informal decision values such
as `draft` and `escalate`. Phase 2 introduces the typed domain model in code, which must
be the single source of truth for the pipeline's vocabulary.

## Decision

The canonical enum values live in `src/domain` and are enforced at runtime by Zod schemas
in `src/schemas`:

- `Intent`: `cancellation_request`, `damaged_item`, `invoice_question`,
  `product_availability`, `unknown`, `out_of_scope`
- `Workflow`: `cancellation`, `damaged_item`, `invoice`, `product_availability`,
  `unsupported`
- `Decision`: `AUTO_REPLY`, `ASK_FOR_MORE_INFORMATION`, `HUMAN_ESCALATION`, `OUT_OF_SCOPE`
- `RiskLevel`: `low`, `medium`, `high`
- `ReasonCode`: the explainability codes defined in `src/domain/enums.ts`

The architecture worked example was updated to use the canonical `Decision` values. Any
`reasonCode` literals shown in that example remain illustrative and non-normative.

## Consequences

Advantages:

- one source of truth for the domain vocabulary, enforced at runtime
- documentation and code no longer disagree on decision values

Trade-off:

- documentation examples must track the enum definitions when they change.

---

# ADR-007

## Title

Human by Exception

## Status

Accepted

## Context

The employer's goal is maximum safe automation.

## Decision

Supported low-risk customer service requests should result in `AUTO_REPLY` whenever
deterministic validation succeeds.

Human escalation is used only for unsupported, ambiguous, risky or policy-conflicting
requests.

## Consequences

Advantages:

- higher automation
- lower operating cost
- better alignment with the project goals

Trade-off:

- the system requires stronger deterministic validation before automatic replies.

---

# ADR-008

## Title

Local sentence-embedding model for Semantic PDF Retrieval (TF-IDF rejected).

## Status

Accepted (supersedes an interim TF-IDF implementation — see History)

## Context

`docs/architecture.md` lists Semantic PDF Retrieval as a *deterministic* stage —
"cosine similarity over a local index" — and the MVP constraints forbid an external vector
database. The supporting docs (`data/README.md`, the PDF-generator docstring, the root
`README.md` planned stack) describe the stage as **embedding**-based semantic retrieval.
Two implementation choices follow: how to turn policy text into vectors, and how to read the
policy PDFs.

An external embeddings API was considered and rejected: it would add a network dependency,
cost, and a non-deterministic external call, conflicting with the stage's deterministic
classification and the "prefer deterministic" principle.

A first implementation used a **TF-IDF vector-space model**. It was deterministic and
dependency-free, but its similarity is **lexical**: it matches only on shared terms, so a
paraphrase such as "call off my purchase" does not match the *cancellation* policy because it
shares no vocabulary with it. That under-delivers on the word *semantic*. TF-IDF was therefore
rejected in favour of true embeddings, with the requirement that they remain **local**.

## Decision

Implement Semantic PDF Retrieval with a **local sentence-embedding model** and cosine
similarity over a **local, file-based index** (`data/vector-index/policy-index.json`):

- passages and queries are embedded with `Xenova/all-MiniLM-L6-v2` (384-dim) run **locally**
  via `@huggingface/transformers` (ONNX Runtime, CPU). The model weights are fetched once and
  cached under `data/models/` (git-ignored); after that, embedding is fully offline;
- dense, L2-normalized embeddings are stored in the local index; a query is embedded the same
  way and scored against every passage by cosine similarity;
- the policy PDFs are read by a small, dependency-free parser that understands the
  uncompressed PDFs produced by `scripts/generate-policy-pdfs.py`, rather than adding a
  third-party PDF library.

There is **no external embedding API** (at build or query time) and **no external vector
database**: ADR-003 and the MVP constraints hold. Embedding generation from fixed model
weights is deterministic, so the stage's deterministic classification also holds.

## Consequences

Advantages:

- genuine **semantic** matching — paraphrases with no shared vocabulary are retrieved;
- still local, offline (after the one-time model download) and reproducible — no API keys,
  per-call cost, or runtime network;
- explainable: every hit is a verbatim, citable policy passage.

Trade-off:

- adds the `@huggingface/transformers` dependency and its ONNX runtime, and a one-time model
  download (~tens of MB, cached). This is heavier than the stdlib-only retrieval but stays
  within the local/offline constraints and is comfortable for the Oracle Always Free target;
- the retrieval stage (`retrievePolicyPassages`) is now **async** (the model loads and runs
  asynchronously);
- the custom PDF reader is intentionally narrow: it parses only the PDFs this project
  generates, not arbitrary PDFs.

## History

- Interim: TF-IDF vector-space model (lexical cosine over a local index). Rejected because the
  similarity was lexical rather than semantic. Superseded by the local embedding model above;
  the index format was bumped from version 1 (sparse TF-IDF) to version 2 (dense embeddings).

---

# ADR-009

## Title

Hybrid Retrieval Layer — combined evidence contract and retrieval/decision boundary.

## Status

Accepted (implements ADR-002)

## Context

ADR-002 establishes *Hybrid Retrieval*: deterministic JSON lookup plus lightweight semantic
PDF retrieval. Phase 4 delivered only the semantic half; **Structured Data Retrieval** was
explicitly deferred. The two paths have different shapes — structured lookup returns exact
records (no score), semantic retrieval returns passages with a similarity score — and the
architecture lists them as two adjacent stages. A downstream consumer needs a single,
predictable evidence contract, and the boundary between *retrieving* evidence and *judging* it
must stay sharp (ADR-001: "LLMs interpret. Rules decide.").

## Decision

Add a **Hybrid Retrieval Layer** that composes two retrieval paths:

- **Structured Data Retrieval** (`structured-retrieval.ts`) resolves the slot keys `orderId`,
  `invoiceId`, `productName` and `customerEmail` to raw business records via deterministic
  lookup maps built over the local JSON data (`business-data.ts`, validated on load). It
  records every attempted lookup (found or not) for explainability, de-duplicates by `ref`,
  and returns facts only. A customer "fact" is a factual aggregation of that customer's orders
  and invoices — no derived judgement.
- **Hybrid Retrieval Layer** (`hybrid-retrieval.ts`, async) runs both paths (concurrently) and
  returns one schema-validated bundle, `HybridRetrievalSchema`:
  `{ caseId?, query, structuredFacts[], policyEvidence[], metadata }`. Similarity scores live
  on `policyEvidence`; `metadata` carries lookups attempted, policy parameters, index size and
  timings. The caller supplies the semantic `query` (e.g. the sanitized email); an empty query
  skips semantic retrieval rather than synthesizing one.
- The layer **retrieves evidence only**: no sufficiency evaluation, no business rule, no
  decision. Those remain later, separate stages.
- The persisted business-data record shapes are formalized as contracts in
  `src/schemas/business-data.schema.ts` (the shapes were implicit in Phase 3). Cross-record
  integrity stays in the standalone `validate-data` checker; the retrieval loader validates
  only that each record is individually well-formed.

## Consequences

Advantages:

- one contract for downstream consumers (`HybridRetrievalSchema`) instead of two;
- explainable retrieval (per-lookup outcomes; citable refs and scores);
- the retrieve/decide boundary is explicit, keeping business logic out of retrieval;
- structured lookups are deterministic, fast (indexed maps) and offline.

Trade-off:

- a small amount of schema duplication between `business-data.schema.ts` and the `validate-data`
  script (which keeps its own internal schemas plus cross-record checks);
- `metadata.timings` are wall-clock and therefore not reproducible across runs (they are
  descriptive only and carry no decision).

## Note on phase numbering

This work was requested as "Phase 5 — Hybrid Retrieval Layer". `docs/roadmap.md` lists
Structured + Semantic retrieval under Phase 4 and names Phase 5 "Decision Engine". The
deliverables here are the structured + hybrid retrieval the request described; the roadmap was
left unchanged per the engineering workflow (no roadmap edits without explicit instruction).

---

# ADR-010

## Title

Decision Engine — deterministic decision contract and two added reason codes.

## Status

Proposed (Phase 5 — Decision Engine; awaiting review)

## Context

Phase 5 implements the Decision Engine: **Data Sufficiency Evaluation**, the **Business Rule
Engine** and the **Decision Gate** (`docs/architecture.md`). The output contracts for these
stages already existed from Phase 2 (`evaluation.schema.ts`, `business-rule.schema.ts`,
`decision.schema.ts`). Two gaps surfaced during implementation:

1. The `ReasonCode` enum (the explainability vocabulary, ADR-006) had codes for every *negative*
   outcome a decision stage can report (`MISSING_REQUIRED_INFORMATION`, `STRUCTURED_DATA_MISSING`,
   `POLICY_MISSING`, `BUSINESS_RULE_CONFLICT`, `ESCALATION_REQUIRED`) but no *positive* code for
   "data is sufficient" or "a rule passed". The schemas require a `reasonCode`, and design
   principle 4 requires every recorded outcome — including the reasons an `AUTO_REPLY` was
   permitted — to be explainable. Reusing a semantically-wrong code (e.g. `AUTO_REPLY_ALLOWED`
   for a sufficiency result) would defeat that.
2. Consumers (Phase 6 Response Generation, Phase 7 Audit) need the three stage outputs together.

## Decision

- Add **two** reason codes to `src/domain/enums.ts`: `DATA_SUFFICIENT` (Data Sufficiency
  Evaluation passed) and `RULE_PASSED` (a business rule was satisfied). No existing code was
  changed. The set stays minimal: all negative/escalation paths reuse the existing codes.
- Add a single composed contract, `DecisionEngineResultSchema`
  (`{ caseId?, evaluation, ruleResults, decision }`), mirroring how the Hybrid Retrieval Layer
  packages its sub-stages (ADR-009), so downstream stages depend on one shape.
- Implement the engine as **deterministic and synchronous** under `src/pipeline/decision/`
  (ADR-001, ADR-005). The Decision Gate orders its checks most-fundamental first (scope →
  confidence → sufficiency → rules) so the reason code names the first blocker, and prefers
  `AUTO_REPLY` whenever every check passes (ADR-007). A missing *customer* slot yields
  `ASK_FOR_MORE_INFORMATION`; a gap on our side (unresolved record, missing policy) yields
  `HUMAN_ESCALATION`.
- Policy thresholds are isolated in `business-rules.ts`: the 24-hour cancellation window and the
  30-day damaged-item claim window. An expired damage claim is a blocking rule with reason code
  `DAMAGE_CLAIM_WINDOW_EXPIRED` and follows `HUMAN_ESCALATION`.

## Consequences

Advantages:

- positive outcomes are explainable with accurate reason codes; the audit trail can show why an
  auto-reply was allowed, not only why one was blocked;
- one decision contract for downstream stages; the retrieve/decide/respond boundaries stay sharp;
- the whole engine is deterministic, fast and unit-testable.

Trade-off:

- two additions to the canonical `ReasonCode` enum (ADR-006). They are additive and documented
  here for review; per the engineering workflow the change is not committed until approved.

## Note on phase numbering

This matches `docs/roadmap.md`: Phase 5 is "Decision Engine". (The earlier "Phase 5 — Hybrid
Retrieval Layer" request in ADR-009 corresponded to the roadmap's Phase 4 retrieval work.)

---

# ADR-011

## Title

Response Generation — provider-neutral LLM layer, German grounded drafts, deterministic
compliance gate.

## Status

Proposed (Phase 6 — Response Generation; awaiting review)

## Context

Phase 6 implements the first real LLM call in the system: **Response Generator**, **Compliance
Validation** and the phase's **Structured JSON Output** (`docs/architecture.md`). Until now no
LLM provider, client or SDK existed in the codebase. Several constraints had to be reconciled:

1. ADR-001/ADR-005 keep business decisions deterministic — the LLM may only *write text*, never
   decide. The Decision Gate (Phase 5) has already committed to one outcome before this phase runs.
2. ADR-004 forbids raw PII reaching an LLM. The masked email satisfies this, but **structured
   business facts** retrieved in Phase 5 also contain customer PII (name, e-mail, address,
   payment method), which would otherwise enter the prompt.
3. The phase's "Structured JSON Output" must not depend on the **Audit** trace, which is Phase 7
   and explicitly out of scope. `FinalApiResponseSchema` mandates an `audit` field, so it cannot
   be the Phase 6 output.
4. The owner requires a provider-neutral LLM abstraction with Groq (`openai/gpt-oss-120b`
   default, `openai/gpt-oss-20b` dev fallback) accessed via the OpenAI SDK, all output as
   Zod-validated JSON, one retry on invalid JSON, and no logging of prompt bodies.

## Decision

- **LLM layer (`src/llm/`)** — a ports-and-adapters boundary. The pipeline depends only on the
  `LlmClient` port (`generateJson(req, schema)`); the single adapter
  (`providers/openai-compatible.ts`) uses the OpenAI SDK pointed at Groq's base URL. Because
  Groq is OpenAI-compatible, the same adapter also serves OpenAI by changing base URL/key/model;
  Anthropic would be a new adapter file implementing the same port, with **no pipeline change**.
  Provider/model/keys come from config (`src/config/env.ts`); `GROQ_API_KEY` is optional at
  parse time so non-LLM builds work, and the factory throws a clear error if it is missing when a
  call is attempted. The adapter retries exactly once on invalid/schema-invalid JSON, does not
  retry transport errors, and never logs prompt or completion bodies.
- **Default model `openai/gpt-oss-120b`** via Groq for quality at negligible prototype cost
  (≈ $0.15 in / $0.60 out per 1M tokens, ~500 TPS as of June 2026), with `openai/gpt-oss-20b`
  as the cheaper dev fallback (set `LLM_MODEL` to it locally).
- **Response Generator (`src/pipeline/response/`)** — consumes the *decided* case and writes a
  **German** customer-facing draft grounded only in the masked email, the (PII-redacted)
  structured facts and the policy passages. It echoes the Decision Gate result unchanged. For
  `HUMAN_ESCALATION` it makes **no LLM call** and returns no draft. Structured facts are
  deterministically reduced to per-kind **PII-safe whitelists**, and evidence references are
  replaced with non-identifying aliases before entering the prompt.
- **Compliance Validation** — deterministic. It requires cited references to exist, rejects
  unsupported promises unless an `AUTO_REPLY` has relevant cited evidence or passed-rule support,
  checks language and raw-PII leakage, and confirms the draft matches the decision. An LLM transport
  or output failure causes a deterministic fallback candidate to pass through this same gate. The
  fallback is canonical and delivered only when compliant; otherwise no response is delivered. The
  Decision Gate result is never changed and human handling is not inferred from a response failure.
- **Structured JSON Output** — a new contract `GeneratedResponseSchema`
  (`{ caseId?, language, generationMode, decision, draft|null, delivered, citedEvidence[], compliance }`).
  It deliberately excludes the audit trace; assembling `FinalApiResponse` (with audit) is Phase 7.
- No new `ReasonCode` was added; existing `ESCALATION_REQUIRED` / `INVALID_LLM_OUTPUT` cover the
  safety-fallback paths.

## Consequences

Advantages:

- the LLM is confined to language generation; the decision stays deterministic and unchanged;
- provider is swappable by config (OpenAI) or one adapter file (Anthropic), with zero pipeline edits;
- defence in depth on PII: masked email **and** redacted facts, plus a deterministic leak check;
- every LLM output is Zod-validated with a single retry; response failures degrade to a validated
  deterministic fallback when available, without changing the deterministic decision.

Trade-off:

- adds the `openai` dependency (used only inside `src/llm`);
- some compliance checks are heuristic (German-language markers, promissory terms and PII patterns) and
  may need tuning; they are intentionally conservative (fail towards escalation);
- automatic cross-model failover to the dev fallback is **not** implemented — model selection is
  config-driven only; this can be added later behind the same port.

## Note on phase numbering

ADR-011 was written when Phase 6 was "Response Generation". The roadmap was subsequently
restructured so Phase 6 is **"LLM Integration"** — it now covers the Response Generator *and*
the LLM interpretation stages (see ADR-012). Audit & Evaluation moved to Phase 7, and remains
out of scope here.

---

# ADR-012

## Title

LLM interpretation stages — Intent Classification, Top-N Ranking and Slot Extraction on the
shared LLM layer.

## Status

Proposed (Phase 6 — LLM Integration; awaiting review)

## Context

The roadmap's Phase 6 was widened from "Response Generation" to **"LLM Integration"**: besides
the Response Generator (ADR-011), the language-understanding stages — Intent Classification,
Top-N Intent Ranking and Slot Extraction — must become real LLM calls. The architecture has
always listed these as LLM stages, but no implementation existed (Phase 3's deterministic
stages, including the PII Sanitizer, Scope Validation and Workflow Enrichment, are also not yet
implemented). Constraints: reuse the provider-neutral `LlmClient` (ADR-011), no vendor SDK
outside `src/llm`, structured JSON validated with Zod, one retry on invalid JSON, no raw PII,
no prompt-body logging, and — critically — no bypassing of the deterministic stages.

## Decision

- Add `src/pipeline/interpretation/` (named after ADR-001, "LLMs interpret"), symmetric with
  `response/`:
  - `intent-classification.ts` — `classifyIntent()` returns `IntentClassificationSchema`
    (intent + confidence + ranked candidates: Intent Classification and Top-N Ranking are one
    call).
  - `slot-extraction.ts` — `extractSlots()` returns `SlotExtractionSchema`.
  - `prompts.ts` — versioned templates (`INTENT_PROMPT_VERSION`, `SLOT_PROMPT_VERSION`) and pure
    builders. The prompt version is carried on each stage's outcome for Phase 7 audit.
- Both stages depend only on `LlmClient` (injectable for tests), use JSON mode, validate with
  Zod, inherit the single invalid-JSON retry from the LLM layer, run at temperature 0, and never
  log prompt or output bodies. They operate on the **PII-masked** email only (ADR-004) and
  preserve masked placeholders verbatim; reconciling tokens with real records stays deterministic
  and is out of scope.
- **Fail-safe via existing deterministic logic, not new logic:** an LLM failure or invalid output
  collapses Intent Classification to `unknown` (the Decision Gate asks for clarification) and Slot
  Extraction to empty slots with every requested field marked missing
  (Data Sufficiency / Decision Gate then ask for information or escalate). A `fallback` flag on
  the outcome records that this happened.
- The stages **interpret only**: they do not perform Scope Validation or Workflow Enrichment and
  make no business decision. Those deterministic stages remain unimplemented and unbypassed.

## Consequences

Advantages:

- the full set of LLM stages now runs through one provider-neutral, Zod-validated, retrying layer;
- prompt versioning makes outputs traceable ahead of Phase 7 audit;
- failures degrade safely through the *existing* deterministic escalation paths — no new decision
  logic, nothing bypassed.

Trade-off:

- a small per-stage outcome wrapper (`{ data, promptVersion, fallback }`) is added rather than
  changing the canonical schemas, since prompt/run metadata belongs to Phase 7;
- the deterministic Phase 3 stages were repaired alongside the Phase 6 safety review. The modules
  are now composable, but an end-to-end customer-email API route remains intentionally
  unimplemented.

## Note on phase numbering

This matches the updated `docs/roadmap.md`: Phase 6 is "LLM Integration"; Phase 7 is "Audit &
Evaluation" (not implemented here).

---

# ADR-013

## Title

Passive Audit & Evaluation layer — boundary instrumentation, provider-neutral cost, and
heuristic evaluation signals.

## Status

Proposed (Phase 7 — Audit & Evaluation; awaiting review)

## Context

Phase 7's goal is complete transparency for every AI interaction: an explainable execution trace
carrying prompt/provider/model metadata, token usage, estimated cost, latency, retry count, JSON
validation result, the decision, compliance outcomes and evaluation metrics. The governing
constraint is that audit must be **completely passive** — it may never change a decision,
workflow, response, compliance result or retry behaviour, never block a response when metadata is
missing, and never store raw prompts, completions or PII. It must be provider-neutral (Groq today;
OpenAI/Anthropic later) and structured for the Phase 8 workbench. The roadmap also requires a
pricing abstraction configurable in code rather than hardcoded inside pipeline stages, returning
`null` for unknown models instead of throwing.

Two facts shaped the design. First, retry count and per-call latency are only knowable *inside*
the provider adapter. Second, the existing interpretation/response stages already degrade safely
and must not be disturbed.

## Decision

- Add `src/pipeline/audit/` as a passive, read-only layer with three isolated concerns:
  - **`llm-recorder.ts`** — `instrumentLlmClient(inner, recorder, { provider })` wraps any
    `LlmClient` at the provider boundary and appends one `LlmAuditMetadata` per call. It forwards
    the request verbatim, returns the result verbatim and re-throws errors verbatim; it does not
    touch prompts, temperature, retry policy, JSON validation or provider behaviour. Because it
    sits at the port, the interpretation and response stages need **no changes**. Recording is
    best-effort (errors swallowed) so audit can never block a call.
  - **`pricing.ts`** — the single home for a provider-neutral, in-code price book (USD per 1M
    tokens) and `estimateCostUsd`. Unknown model or missing tokens → `null`, never a throw. Rates
    are documented as prototype estimates, not authoritative production pricing.
  - **`evaluation-metrics.ts`** — `deriveEvaluationMetrics`, deterministic heuristic signals
    computed read-only from recorded metadata. They are observability indicators, explicitly
    **not** ground truth or a measure of model correctness (that is Phase 9).
  - **`audit-trace.ts`** — `buildAuditTrace`, a pure composition function that assembles the
    `AuditRecord` from stage outputs. It mutates no input and copies every decision value through
    unchanged; the output is deep-cloned by `AuditRecordSchema.parse`, so it never aliases
    pipeline state.
- Extend the LLM port **additively** for observability only: `LlmJsonResult` and `LlmError` gain
  an optional `meta` (latency, retry count, provider request id, JSON-validation result) populated
  by the adapter. This carries no behaviour and existing test doubles may omit it.
- PII posture: the record stores slot **keys** (never values), a non-reversible prompt
  **fingerprint** (never prompt text), counts, codes and statuses — no raw email, prompt,
  completion or personal data. Provider neutrality: `provider` is a free string and the schema has
  no vendor-specific fields, so a future adapter populates the same shape unchanged.

## Consequences

Advantages:

- a full, explainable, frontend-ready trace per request, captured without altering any stage;
- retry count and latency are recorded accurately because the adapter — the only place that knows
  them — reports them as passive metadata;
- cost policy lives in one provider-neutral module; adding a provider/model is a one-table edit.

Trade-offs:

- the audit layer is a library not yet wired into an end-to-end route; an orchestrator (or the
  Phase 8 workbench) composes `instrumentLlmClient` + `buildAuditTrace`. This keeps Phase 7
  strictly observational and avoids introducing a pipeline entry point ahead of its phase;
- evaluation metrics are intentionally heuristic; they flag risk for review but do not certify
  correctness.

---

# ADR-014

## Title

Human by Exception v2 — escalate on exception signals, not on the absence of a happy path.

## Status

Accepted (refines the *implementation* of ADR-007; ADR-007 remains accepted)

## Context

ADR-007 set the goal of maximum safe automation, but the Decision Gate implemented the opposite
default: it escalated on the *absence of a happy path* rather than on the *presence of a real
exception*. Three branches caused this — any failed business rule escalated, any unresolved record
escalated, and any unknown/ambiguous intent escalated — so most "negative" outcomes (an order that
can no longer be cancelled, a refunded invoice, an item that arrived damaged) were sent to a human
even though they are fully grounded in policy and business data and require no human judgement. For
an interview prototype this demonstrated "Human by Default", and for an enterprise Customer
Operations platform it would inflate the human queue and hide the system's real capability.

The model also lacked the one thing that makes aggressive automation *safe*: a deterministic
detector for the cases policy **explicitly** reserves for humans (disputes, chargebacks,
goodwill/Kulanz, fraud, legal). Because those signals were not detected, the system compensated by
escalating broadly.

## Decision

Adopt **Human by Exception v2** — the system automates every interaction it can handle safely, and
escalates only when safe automation is genuinely impossible or policy explicitly requires manual
review. Three changes deliver this:

1. **Classify each workflow by the kind of decision it is.**
   - *Informational* (product availability, invoice questions) — answer from data + policy for
     **all** statuses (including refunded/voided invoices).
   - *Intake* (damaged item) — acknowledge eligibility, explain policy, generate a simulated
     reference, request evidence and state next steps. Claims older than the policy's 30-day window
     are a documented exception and go to a human.
   - *Action assessment* (cancellation) — an eligible request is reported as policy-eligible with a
     simulated reference; an ineligible one is **explained** with the return-after-delivery path.
     The prototype does not mutate an order or payment system.

2. **Add a deterministic Escalation-Trigger Guard** (`escalation-triggers.ts`) that scans the
   masked email for the human-only signals above (German + English). When it fires, the Decision
   Gate escalates regardless of eligibility. This is the precise safety net that makes the
   relaxations safe.

3. **Re-order and re-target the Decision Gate.** New order: explicit escalation signal →
   out-of-scope → unknown/ambiguous (**ASK**) → missing customer slot (**ASK**) → unresolved record
   (**ASK**) → failed *blocking* rule (expired damage window → **ESC**) → damaged-item not delivered (**ASK**)
   → AUTO_REPLY. Business rules are classified `blocking` vs `informational`; ordinary eligibility
   outcomes shape the reply, while the expired damage-window rule is explicitly blocking.

Supporting changes: a deterministic **Case Intake** helper (`case-intake.ts`) mints simulated
references (`CXL-…`, `RMA-…`) without creating an external ticket; the **response prompt** is held to a four-part customer-guidance
contract (what happened · why · what happens next · what to do) and quotes the case reference; a
deterministic **Customer Guidance** module (`customer-guidance.ts`) powers the Workbench
"why/next" panels. For safe `AUTO_REPLY` and `ASK_FOR_MORE_INFORMATION` outcomes, a deterministic
fallback becomes canonical only after compliance passes. Grounding stays conservative: no broad
hard-coded policy fallback is added.

## What does NOT change

- **ADR-001 / ADR-005** — all decisions remain deterministic; the LLM still only writes text.
- **Pipeline order and responsibility split** — stages keep their order; the guard and intake slot
  into the existing decision boundary; the audit layer stays passive (ADR-013).
- **PII strategy (ADR-004)**, **provider abstraction (ADR-011)**, **hybrid retrieval (ADR-009)** —
  untouched. `HUMAN_ESCALATION` still makes no response-generation LLM call (ADR-011) and produces
  no automated customer draft.
- **Schemas / domain enums** — the stabilization adds the explicit
  `DAMAGE_CLAIM_WINDOW_EXPIRED` reason code; `BusinessRuleResult.kind` marks this policy rule as
  blocking.

## Consequences

Advantages:

- the large majority of requests are resolved automatically; escalations become meaningful;
- the safety net is precise (explicit signals) and fully auditable;
- safe automated outcomes retain a compliant deterministic response when LLM wording fails.

Trade-offs:

- more deterministic branches and message templates to maintain;
- the escalation-trigger lexicon is heuristic and will need tuning;
- "negative" auto-replies (e.g. an ineligible cancellation) depend on cited policy evidence to pass
  the compliance gate; when retrieval returns no usable passage the case still falls back to a human.

---

# ADR-015

## Title

Offline deterministic system evaluation over the public pipeline result.

## Status

Proposed (Phase 9 — System Evaluation; awaiting review)

## Context

Phase 7 audit metrics are intentionally heuristic observability signals, not authoritative quality
measurement. Phase 9 requires a synthetic dataset, expected outputs, prompt/intent/slot/decision
review, hallucination and grounding checks, safe-escalation verification, a manual checklist, and
cost/latency analysis. Evaluation must not weaken the deterministic Decision Engine or turn a
quality score into another routing mechanism.

## Decision

- Implement `src/evaluation/` as an **offline, read-only consumer** of the complete Phase 8
  `processEmail` result. Evaluation results never enter the runtime pipeline.
- Store a versioned synthetic dataset with curated expected outputs under `data/evaluation/` and
  validate it with Zod before execution. Labels are human-authored; the evaluated model does not
  grade itself.
- Score each concern separately and deterministically: versioned/schema-valid/first-pass prompt
  calls, exact intent and labelled slots, exact deterministic decision, unsafe-draft containment,
  cited grounding, explicit safe escalation, and known-value audit PII exclusion.
- Reuse the passive provider-neutral audit record for token, estimated-cost, retry, and LLM-latency
  analysis. Do not import a vendor SDK or duplicate provider instrumentation in evaluation.
- Generate both a machine-readable local artifact and a reviewable Markdown report. The report
  explicitly distinguishes deterministic safety assertions from semantic truth and includes a
  manual review checklist.

## Consequences

Advantages:

- the complete system is evaluated through its real entry point without changing production
  behaviour;
- regressions are attributable to a specific concern instead of one opaque aggregate score;
- provider/model runs remain comparable through a stable dataset and report contract;
- Human by Exception is directly tested: genuine exception signals must escalate and normal
  supported cases must not.

Trade-offs:

- live results vary with provider/model behaviour and require API access;
- exact expected outputs and synthetic coverage require ongoing human maintenance;
- citation/compliance checks cannot prove full natural-language entailment, so manual review
  remains necessary;
- provider-call latency excludes local retrieval and deterministic processing time.
