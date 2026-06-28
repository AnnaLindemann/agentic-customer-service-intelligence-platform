# Architecture

## Core Concept

This project implements a controlled customer service email processing system.
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
- **Decision Gate** — Decides to draft a reply or escalate, based on rules, sufficiency and confidence.
- **Response Generator** — Uses an LLM to draft a reply grounded only in retrieved evidence.
- **Compliance Validation** — Deterministically verifies the draft is grounded and safe.
- **Audit Trace** — Records every stage, decision and reason code.
- **Structured JSON Output** — Emits the final result: draft or escalation, evidence, decisions, reasons.

## Worked Example

**Incoming email**

> "Hi, I'd like to cancel order 10293. My email is jane.doe@example.com."

**Main processing steps**

PII Sanitizer masks the email address → Intent Classification = `cancellation_request` →
Scope Validation passes (supported workflow) → Slot Extraction pulls `orderId: 10293` →
Structured Data Retrieval finds the order → Semantic PDF Retrieval finds the cancellation
policy → Data Sufficiency Evaluation passes → Business Rule Engine confirms the order is
within the cancellation window → Decision Gate = `draft` → Response Generator writes the
reply → Compliance Validation passes → Audit Trace recorded.

**Example JSON output**

```json
{
  "decision": "AUTO_REPLY",
  "intent": "cancellation_request",
  "draft": "Hello, your order 10293 is eligible for cancellation and has been cancelled...",
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
