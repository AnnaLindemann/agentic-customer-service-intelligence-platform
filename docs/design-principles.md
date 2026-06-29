# Design Principles

This document is the single source of truth for the project's engineering philosophy.
All other documents reference these principles instead of restating them.

---

## 1. LLMs interpret. Rules decide.

LLMs are used for language understanding and language generation only.
Business decisions, validation, routing and safety checks are deterministic.

## 2. Prefer deterministic implementations whenever possible.

If a responsibility can be implemented as deterministic code with acceptable quality,
it must be. Determinism is preferred for anything testable, auditable or safety-critical.

## 3. Agent responsibilities do not require LLM agents.

A responsibility boundary is a unit of accountability, not a mandatory LLM call.
Most pipeline stages are plain deterministic modules. LLMs are the exception, not the default.

## 4. Every important decision must be explainable.

Every decision produces a reason code and is recorded in the audit trace.
A human must be able to reconstruct *why* an outcome occurred without reading model internals.

## 5. Every customer response must be grounded in evidence.

A draft response may only use facts retrieved from structured business data or policy PDFs.
Unsupported claims are not allowed. No grounding means no answer.

## 6. Safety is more important than automation.

When correctness and automation conflict, the system chooses correctness.
It is acceptable to produce no draft; it is not acceptable to produce an unsafe one.

## 7. Human escalation is a successful outcome.

Escalating to a human when confidence, data sufficiency or compliance checks fail is a
designed, successful path — not a failure. The system is an assistant, not an autonomous actor.
This does not make escalation the default path: see Principle 10 (*Human by Exception*).

## 8. Simplicity over unnecessary infrastructure.

The MVP uses the lightest infrastructure that satisfies the task: local JSON data,
a local vector index, and local PDFs. Heavy infrastructure is added only when justified.

## 9. Prefer deterministic solutions unless AI provides measurable value.

## 10. Human by Exception.

The system should automatically process supported low-risk customer service requests.

Human escalation is reserved for:

- unsupported workflows
- ambiguous intent
- insufficient data
- policy conflicts
- legal or high-risk requests
- failed compliance validation

Human review is the exception, not the default.

---

These principles take priority over convenience. When in doubt, choose the option that is
safer, more explainable and more deterministic.
