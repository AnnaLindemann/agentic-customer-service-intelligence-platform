# Product Backlog

This document contains ideas and improvements that are intentionally excluded from the MVP.

Items in this backlog must not be implemented before the MVP is completed.

---

# High Priority

## Escalation Review Interface

Human review applies only to escalated cases — those the Decision Gate routes to
`HUMAN_ESCALATION`. Automatically processed (`AUTO_REPLY`) cases do not pass through this
interface.

For an escalated case, allow a support agent to:

- review the generated response;
- inspect retrieved evidence;
- approve or edit the draft before sending.

---

## Evaluation Dashboard

Display evaluation metrics:

- intent accuracy;
- retrieval accuracy;
- decision accuracy;
- escalation rate.

---

## Prompt Versioning

Track:

- prompt versions;
- prompt changes;
- model versions;
- evaluation history.

---

# Medium Priority

## CRM Integration

Support retrieving customer information directly from a CRM.

---

## Multi-channel Input

Extend the platform to support:

- chat;
- ticket systems;
- voice transcripts.

---

## Authentication

Add user authentication and role-based access.

---

# Low Priority

## Analytics Dashboard

Business reporting and operational insights.

---

## Vector Database

Replace the local vector index with:

- Qdrant;
- pgvector;
- Pinecone.

---

## Multi-Agent Orchestration

Evaluate whether dedicated AI agents provide measurable benefits over the current hybrid architecture.

This should only be introduced if it improves quality, maintainability or user value.

---

# Not Planned for MVP

The following are explicitly out of scope:

- ERP integration
- SharePoint integration
- Real email inbox
- OCR
- Production scalability
- Autonomous agent loops