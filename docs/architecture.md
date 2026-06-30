# Architecture

## Core Concept

This interview prototype implements a controlled customer service email decision engine over
synthetic business data. Its lightweight browser workbench visualizes the pipeline; it is not a
production agent console and does not execute operations in external systems.
It uses agent-like responsibility boundaries, but not every component is an LLM agent.

The system combines:

- deterministic modules for safety-critical tasks;
- LLM-powered components for language understanding and response generation;
- structured retrieval from business data;
- lightweight semantic PDF retrieval for policy grounding.

The engineering philosophy behind these choices — including *"LLMs interpret. Rules decide."*
and *"Agent responsibilities do not require LLM agents."* — lives in
[design-principles.md](design-principles.md) and is not repeated here.

## Responsibility Split

LLM-powered stages: Intent Classification, Top-N Intent Ranking, Slot Extraction,
Response Generator.

Deterministic stages: PII Sanitizer, Scope Validation, Workflow Enrichment,
Case State Builder, Structured Data Retrieval, Semantic PDF Retrieval (cosine similarity over
a local index), Data Sufficiency Evaluation, Business Rule Engine, Decision Gate,
Compliance Validation, Audit Trace.

## MVP Processing Pipeline

```
Customer Email
  ↓ PII Sanitizer
  ↓ Intent Classification
  ↓ Top-N Intent Ranking
  ↓ Scope Validation
  ↓ Slot Extraction
  ↓ Workflow Enrichment
  ↓ Case State Builder
  ↓ Structured Data Retrieval
  ↓ Semantic PDF Retrieval
  ↓ Data Sufficiency Evaluation
  ↓ Business Rule Engine
  ↓ Decision Gate
  ↓ Response Generator
  ↓ Compliance Validation
  ↓ Audit Trace
  ↓ Structured JSON Output
```

## Pipeline Stages

Each stage has one responsibility:

- **PII Sanitizer** — Deterministically masks personal data so no raw PII reaches an LLM.
- **Intent Classification** — Uses an LLM to classify the email into a customer intent.
- **Top-N Intent Ranking** — Returns the top candidate intents with confidence scores.
- **Scope Validation** — Deterministically checks the intent maps to a supported workflow.
- **Slot Extraction** — Uses an LLM to extract structured fields (e.g. order id, customer email).
- **Workflow Enrichment** — Adds workflow-specific required fields and defaults to the case.
- **Case State Builder** — Assembles all extracted and enriched data into a single case object.
- **Structured Data Retrieval** — Looks up customer/order facts in local JSON business data.
- **Semantic PDF Retrieval** — Retrieves relevant policy passages from PDFs via cosine similarity.
- **Data Sufficiency Evaluation** — Checks whether enough evidence exists to answer safely.
- **Business Rule Engine** — Applies company rules deterministically to the case.
- **Decision Gate** — Returns exactly one outcome (`AUTO_REPLY`, `ASK_FOR_MORE_INFORMATION`,
  `HUMAN_ESCALATION`, `OUT_OF_SCOPE`) based on rules, sufficiency and confidence.
- **Response Generator** — Uses an LLM to word a grounded reply and falls back to a canonical
  deterministic response when generation or compliance fails and a safe fallback exists.
- **Compliance Validation** — Deterministically verifies the draft is grounded and safe.
- **Audit Trace** — Passively records every stage, decision and reason code, plus per-call LLM
  metadata (tokens, latency, retries, estimated cost), compliance outcomes and derived evaluation
  signals. It is observational only: it never changes a decision, workflow, response, compliance
  result or retry behaviour, and it stores no raw prompt, completion or PII. The output is a
  provider-neutral, frontend-ready `AuditRecord`. See [decisions.md](decisions.md) (ADR-013).
- **Structured JSON Output** — Emits the final result: draft or escalation, evidence, decisions, reasons.

## Decision Gate Outcomes

The Decision Gate returns exactly one of four outcomes:

- `AUTO_REPLY`
- `ASK_FOR_MORE_INFORMATION`
- `HUMAN_ESCALATION`
- `OUT_OF_SCOPE`

`AUTO_REPLY` is the preferred outcome whenever deterministic validation succeeds and
sufficient evidence exists. The system is built for maximum safe automation, so supported
low-risk requests should be answered automatically.

`HUMAN_ESCALATION` is a safety fallback rather than the normal processing path. It is used
only when automation would be unsafe or impossible. See
[design-principles.md](design-principles.md) (*Human by Exception*).

`OUT_OF_SCOPE` is an understood non-customer-service request that receives a deterministic
redirect and does not consume human-review capacity.

## Escalation Triggers

The Decision Gate escalates to a human when one or more of the following conditions hold:

- legal threats
- insufficient evidence
- policy conflicts
- damage claims outside the 30-day policy window
- sensitive payment or personal data that cannot be safely minimized

## Worked Example

**Incoming email**

> "Hi, I'd like to cancel order 10293. My email is jane.doe@example.com."

**Main processing steps**

PII Sanitizer masks the email address → Intent Classification = `cancellation_request` →
Scope Validation passes (supported workflow) → Slot Extraction pulls `orderId: 10293` →
Structured Data Retrieval finds the order → Semantic PDF Retrieval finds the cancellation
policy → Data Sufficiency Evaluation passes → Business Rule Engine confirms the order is
within the cancellation window → Decision Gate = `AUTO_REPLY` → Response Generator explains
eligibility and the simulated next step → Compliance Validation passes → Audit Trace recorded.

**Example JSON output**

```json
{
  "decision": "AUTO_REPLY",
  "intent": "cancellation_request",
  "draft": "Hello, your cancellation request is eligible under policy. This prototype does not modify the order system...",
  "evidence": [
    { "source": "business_data", "ref": "order:10293" },
    { "source": "policy_pdf", "ref": "cancellation-policy.pdf#p2" }
  ],
  "decisions": [
    { "stage": "DataSufficiencyEvaluation", "result": "sufficient", "reasonCode": "DATA_OK" },
    { "stage": "BusinessRuleEngine", "result": "within_window", "reasonCode": "CANCEL_ALLOWED" },
    { "stage": "DecisionGate", "result": "AUTO_REPLY", "reasonCode": "AUTO_REPLY_ALLOWED" },
    { "stage": "ComplianceValidation", "result": "passed", "reasonCode": "GROUNDED_OK" }
  ]
}
```

An escalation produces the same shape with `"decision": "HUMAN_ESCALATION"`, no `draft`,
and a reason code explaining the escalation.

> Note: `decision` uses the canonical `Decision` enum values established in Phase 2
> (`AUTO_REPLY`, `ASK_FOR_MORE_INFORMATION`, `HUMAN_ESCALATION`). The other `reasonCode`
> values shown above are illustrative; the authoritative `ReasonCode` set lives in
> `src/domain`. See [decisions.md](decisions.md) (ADR-006).

## Audit & Evaluation

The Audit & Evaluation layer (`src/pipeline/audit/`) is **passive**: it observes the outputs of
stages that already ran and composes one `AuditRecord`. It is on no decision path and changes no
behaviour. It has three concerns, each isolated:

- **Instrumentation** — `instrumentLlmClient` wraps any `LlmClient` and records per-call metadata
  (provider, configured/returned model, request id, prompt version, a non-reversible prompt
  *fingerprint*, tokens, latency, retry count, JSON-validation result, error kind). It forwards
  the request, result, retries and JSON validation **unchanged**, so the interpretation and
  response stages need no edits and behaviour is identical with or without it.
- **Pricing** — a single provider-neutral module holds an in-code price book (USD per 1M tokens)
  and estimates per-call cost. Models with unknown pricing yield `null`, never an error. Rates are
  prototype estimates, not authoritative production pricing.
- **Evaluation metrics** — deterministic *heuristic* signals (hallucination/grounding/PII/
  escalation risk, overall safety) derived read-only from the recorded metadata. They are
  indicators for observability, **not** ground truth or a measure of model correctness;
  authoritative quality measurement is Phase 9 (System Evaluation).

## System Evaluation (Phase 9)

System Evaluation is an offline consumer of the complete pipeline, not a pipeline stage. It runs a
versioned, Zod-validated synthetic dataset through the same `processEmail` entry point used by the
workbench and compares the published result with curated expected outputs.

The scorer is deterministic and read-only. It evaluates prompt reliability, intent and slot
accuracy, deterministic decision accuracy, hallucination containment, grounding, safe escalation,
audit PII exclusion, cost, and LLM latency. It cannot change a decision, retry policy, prompt,
provider call, response, or compliance result. Provider abstraction is preserved because the
runner uses the configured `LlmClient` through the existing orchestrator; no provider SDK appears
in the evaluation layer.

Machine-readable results are generated under git-ignored `artifacts/evaluation/`; the latest
human-readable deliverable is `docs/evaluation-report.md`. See [evaluation.md](evaluation.md) and
[ADR-015](decisions.md).

The record stores no raw prompt, completion, PII or slot values (slot *keys* and a prompt
fingerprint only), and its schema is provider-neutral — a future OpenAI or Anthropic adapter
populates the same shape unchanged. See [decisions.md](decisions.md) (ADR-013).

## Supported Workflows

- Cancellation Request
- Damaged Product Complaint
- Invoice Question
- Product Availability

## MVP Constraints

- Email only
- Local JSON business data
- Local PDF documents
- Local vector index
- No external vector database
- No PostgreSQL
- No LangGraph
- No autonomous multi-agent loops
- No CRM integration

Structured business records and evaluation emails are synthetic. The local embedding model and
file-based vector index intentionally keep PDF retrieval lightweight. Production would additionally
require authentication and authorization, CRM/ERP and ticket integrations, persistent storage, a
production vector database where scale justifies it, monitoring and observability dashboards, a
human-review queue, durable retries, deployment hardening, and labelled production evaluation data.
