# Explainable AI Customer Service Decision Engine

An interview prototype demonstrating how routine customer-service requests can be automated safely by combining LLM reasoning with deterministic business logic.

The objective is not to build a production-ready customer support platform, but to demonstrate an architecture that maximizes safe automation while keeping human involvement to genuine exceptions ("Human by Exception").

> **LLMs interpret. Rules decide.**

---

# Business Goal

Instead of treating every customer email as a chatbot conversation, the system processes each request through a controlled decision pipeline.

The LLM is responsible for understanding language, while all customer-impacting business decisions remain deterministic, explainable and policy-driven.

Supported low-risk requests are processed automatically. Ambiguous requests receive a clarification,
understood out-of-scope requests are redirected, and genuine policy or safety exceptions are escalated.

---

# System Architecture

The processing pipeline consists of:

Customer Email

→ PII Sanitization

→ Intent Classification

→ Slot Extraction

→ Hybrid Retrieval (Business Data + Policy PDFs)

→ Business Rule Engine

→ Decision Gate

→ Response Generation

→ Compliance Validation

→ Audit Trace

→ Customer Response

The browser workbench visualizes every stage of this pipeline to make the system's reasoning transparent.

---

# Responsibilities

## LLM

* Intent classification
* Information extraction
* Natural language response generation

## Deterministic Logic

* PII protection
* Scope validation
* Hybrid retrieval orchestration
* Business rule evaluation
* Decision Gate
* Compliance validation
* Audit trace
* Human-by-Exception routing

This separation ensures that language understanding is probabilistic, while business decisions remain deterministic and explainable.

---

# Evaluation

The project includes an offline evaluation framework that executes synthetic customer emails through the complete prototype pipeline.

The evaluation measures:

* intent accuracy
* decision accuracy
* grounding
* hallucination safety
* safe escalation
* response quality
* latency
* estimated LLM cost

Evaluation is read-only and never affects runtime behaviour.

---

# Running the Project

Clone the repository.

Create a .env file and configure the required environment variables:
GROQ_API_KEY=your_api_key
LLM_MODEL=openai/gpt-oss-20b

Build the local retrieval index:
npm install
npm run build:index
Start the application:
docker compose up --build

Open the browser workbench and submit one of the provided demo scenarios or your own customer email.

Note: The first request may take up to approximately one minute because the application runs on a resource-constrained Oracle Cloud instance and needs to initialize the retrieval model. Subsequent requests are typically much faster.
---

# Known Limitations

This repository intentionally contains an interview prototype.

To keep the scope focused:

* synthetic business data is used;
* no relational database is included;
* no external vector database is used;
* business operations (for example order updates) are simulated;
* the frontend is a lightweight demonstration workbench;
* evaluation is based on synthetic scenarios;
* external LLM availability may affect evaluation results.

---

# Production Considerations

For a production implementation I would additionally introduce:

* authentication and authorization;
* CRM / ERP / ticketing integrations;
* persistent relational database;
* production-grade vector database;
* real email ingestion;
* human review queue and case assignment;
* monitoring and observability;
* retry infrastructure;
* role-based access control;
* production evaluation datasets built from historical traffic;
* continuous model evaluation and comparison.

These capabilities are intentionally outside the scope of this prototype.

The workbench may generate simulated case references and policy decisions, but it never cancels an
order, issues a refund, creates a CRM ticket, or mutates another operational system.

---

# Documentation

Additional documentation is available in the `docs/` directory:

* Architecture
* Design Principles
* Architecture Decision Records (ADR)
* Evaluation Framework
* Engineering Workflow
* Progress Log

---

# Project Philosophy

The main objective of this prototype is not to demonstrate the use of an LLM.

It is to demonstrate how AI can be integrated into customer operations in a way that is explainable, measurable and safe.

Routine work should be automated wherever possible.

Human expertise should be reserved for genuine exceptions.
