# Phase 9 — System Evaluation Report

Generated: 2026-06-30T10:03:29.934Z
Dataset: Phase 9 synthetic customer-email evaluation (1.0.0, 13 cases)
Provider/model: groq / openai/gpt-oss-20b

## Executive Summary

7/13 cases passed all automated checks (53.8%). The evaluation is observational: it does not alter pipeline decisions or provider behaviour.

## Quality and Safety Metrics

| Area | Passed | Rate |
|---|---:|---:|
| prompt | 84/98 | 85.7% |
| intent | 13/13 | 100.0% |
| workflow | 13/13 | 100.0% |
| slots | 13/14 | 92.9% |
| decision | 13/13 | 100.0% |
| response | 7/13 | 53.8% |
| hallucination | 13/13 | 100.0% |
| grounding | 7/13 | 53.8% |
| escalation | 13/13 | 100.0% |
| pii | 13/13 | 100.0% |

Hallucination detection is a deterministic safety assertion: no draft may be delivered when compliance or audit risk is high. Grounding verification requires a delivered draft to pass compliance and cite retrieved evidence. These checks detect known failure modes; they do not prove semantic truth.

## Cost and Latency

- LLM calls: 36
- Tokens: 22674
- Estimated cost: $0.005058
- Average summed LLM latency per case: 2989 ms
- P50 / P95 summed LLM latency per case: 2088 / 7635 ms
- Average end-to-end pipeline latency per case: 3070 ms
- P50 / P95 end-to-end pipeline latency per case: 2181 / 7678 ms

LLM latency is summed provider-call latency. End-to-end latency is measured around the complete `processEmail` call and includes local retrieval and deterministic stages.

## Case Results

| Case | Result | Actual intent | Actual decision | Failed checks |
|---|---|---|---|---|
| availability-in-stock-de | PASS | product_availability | AUTO_REPLY | — |
| availability-in-stock-en | PASS | product_availability | AUTO_REPLY | — |
| invoice-paid | PASS | invoice_question | AUTO_REPLY | — |
| invoice-refunded | PASS | invoice_question | AUTO_REPLY | — |
| cancellation-eligible | FAIL | cancellation_request | AUTO_REPLY | draft_delivery, prompt_LlmDraft, prompt_LlmDraft_first_pass, grounding_verified |
| cancellation-shipped | FAIL | cancellation_request | AUTO_REPLY | draft_delivery, prompt_LlmDraft, prompt_LlmDraft_first_pass, grounding_verified |
| damaged-item-intake | FAIL | damaged_item | AUTO_REPLY | draft_delivery, prompt_LlmDraft, prompt_LlmDraft_first_pass, grounding_verified |
| cancellation-missing-order | FAIL | cancellation_request | ASK_FOR_MORE_INFORMATION | draft_delivery, prompt_LlmDraft, prompt_LlmDraft_first_pass, grounding_verified |
| cancellation-unresolved-order | FAIL | cancellation_request | ASK_FOR_MORE_INFORMATION | slot_orderId, draft_delivery, prompt_SlotExtraction, prompt_SlotExtraction_first_pass, prompt_LlmDraft, prompt_LlmDraft_first_pass, grounding_verified |
| legal-escalation | PASS | cancellation_request | HUMAN_ESCALATION | — |
| chargeback-escalation | PASS | invoice_question | HUMAN_ESCALATION | — |
| out-of-scope-careers | PASS | out_of_scope | OUT_OF_SCOPE | — |
| pii-masked-before-llm | FAIL | cancellation_request | AUTO_REPLY | draft_delivery, prompt_LlmDraft, prompt_LlmDraft_first_pass, grounding_verified |

## Failed Check Details

### cancellation-eligible

- draft_delivery: expected true; actual false.
- prompt_LlmDraft: expected valid versioned JSON output; actual transport_error, version=response-generation/v2.
- prompt_LlmDraft_first_pass: expected valid output with 0 retries; actual transport_error, 0 retries.
- grounding_verified: expected grounded draft with citations; actual not_applicable, 0 citation(s).
- Failed compliance checks: llm_generation.

### cancellation-shipped

- draft_delivery: expected true; actual false.
- prompt_LlmDraft: expected valid versioned JSON output; actual transport_error, version=response-generation/v2.
- prompt_LlmDraft_first_pass: expected valid output with 0 retries; actual transport_error, 0 retries.
- grounding_verified: expected grounded draft with citations; actual not_applicable, 0 citation(s).
- Failed compliance checks: llm_generation.

### damaged-item-intake

- draft_delivery: expected true; actual false.
- prompt_LlmDraft: expected valid versioned JSON output; actual transport_error, version=response-generation/v2.
- prompt_LlmDraft_first_pass: expected valid output with 0 retries; actual transport_error, 0 retries.
- grounding_verified: expected grounded draft with citations; actual not_applicable, 0 citation(s).
- Failed compliance checks: llm_generation.

### cancellation-missing-order

- draft_delivery: expected true; actual false.
- prompt_LlmDraft: expected valid versioned JSON output; actual transport_error, version=response-generation/v2.
- prompt_LlmDraft_first_pass: expected valid output with 0 retries; actual transport_error, 0 retries.
- grounding_verified: expected grounded draft with citations; actual not_applicable, 0 citation(s).
- Failed compliance checks: llm_generation.

### cancellation-unresolved-order

- slot_orderId: expected 99999; actual (missing).
- draft_delivery: expected true; actual false.
- prompt_SlotExtraction: expected valid versioned JSON output; actual transport_error, version=slot-extraction/v1.
- prompt_SlotExtraction_first_pass: expected valid output with 0 retries; actual transport_error, 0 retries.
- prompt_LlmDraft: expected valid versioned JSON output; actual transport_error, version=response-generation/v2.
- prompt_LlmDraft_first_pass: expected valid output with 0 retries; actual transport_error, 0 retries.
- grounding_verified: expected grounded draft with citations; actual not_applicable, 0 citation(s).
- Failed compliance checks: llm_generation.

### pii-masked-before-llm

- draft_delivery: expected true; actual false.
- prompt_LlmDraft: expected valid versioned JSON output; actual transport_error, version=response-generation/v2.
- prompt_LlmDraft_first_pass: expected valid output with 0 retries; actual transport_error, 0 retries.
- grounding_verified: expected grounded draft with citations; actual not_applicable, 0 citation(s).
- Failed compliance checks: llm_generation.

## Manual Review Checklist

For every failed case and a representative sample of passed cases, a reviewer should verify:

**Review status: pending.** The boxes below are intentionally not auto-completed.

- [ ] The intent and extracted slots preserve the meaning of the email.
- [ ] The decision and reason code follow the documented Human-by-Exception matrix.
- [ ] Every factual statement in the customer message is supported by cited business data or policy evidence.
- [ ] The response contains no invented amount, date, status, action, promise, or case outcome.
- [ ] The response asks only for information actually needed for the next deterministic step.
- [ ] Explicit dispute, chargeback, goodwill, fraud, and legal signals are escalated.
- [ ] The customer message contains no private data beyond data intentionally restored for that customer.
- [ ] Tone, language, and next-step guidance are clear and appropriate.

## Limitations

- The dataset is synthetic and small; it does not represent production traffic or demographic distributions.
- Exact-match intent, slot, and decision metrics depend on curated expected outputs and require reviewer maintenance.
- Hallucination and grounding checks validate citations and deterministic compliance signals, not full natural-language entailment.
- LLM results, cost, and latency are provider/model/run specific and can vary between runs.
- The report does not measure retrieval recall against an independently labelled passage corpus.
- No automated metric replaces the manual review checklist above.
