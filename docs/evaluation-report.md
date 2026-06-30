# Phase 9 — System Evaluation Report

Generated: 2026-06-30T12:10:50.147Z
Dataset: Phase 9 synthetic customer-email evaluation (1.1.0, 14 cases)
Provider/model: groq / openai/gpt-oss-20b

## Executive Summary

8/14 cases passed all automated checks (57.1%). The evaluation is observational: it does not alter pipeline decisions or provider behaviour.

Deterministic decision, response delivery, hallucination containment, grounding and escalation checks all passed. Strict all-of-case acceptance also includes provider-dependent prompt and slot reliability.

## Quality and Safety Metrics

| Area | Passed | Rate |
|---|---:|---:|
| prompt | 92/104 | 88.5% |
| intent | 14/14 | 100.0% |
| workflow | 14/14 | 100.0% |
| slots | 15/16 | 93.8% |
| decision | 15/15 | 100.0% |
| response | 14/14 | 100.0% |
| hallucination | 14/14 | 100.0% |
| grounding | 14/14 | 100.0% |
| escalation | 14/14 | 100.0% |
| pii | 14/14 | 100.0% |

Hallucination detection is a deterministic safety assertion: no draft may be delivered when compliance or audit risk is high. Grounding verification requires a delivered draft to pass compliance and cite retrieved evidence. These checks detect known failure modes; they do not prove semantic truth.

## Cost and Latency

- LLM calls: 38
- Tokens: 25595
- Estimated cost: $0.005539
- Average summed LLM latency per case: 2930 ms
- P50 / P95 summed LLM latency per case: 2689 / 5542 ms
- Average end-to-end pipeline latency per case: 2974 ms
- P50 / P95 end-to-end pipeline latency per case: 2713 / 5564 ms

LLM latency is summed provider-call latency. End-to-end latency is measured around the complete `processEmail` call and includes local retrieval and deterministic stages.

## Case Results

| Case | Result | Actual intent | Actual decision | Response mode | Failed checks |
|---|---|---|---|---|---|
| availability-in-stock-de | PASS | product_availability | AUTO_REPLY | LLM | — |
| availability-in-stock-en | PASS | product_availability | AUTO_REPLY | LLM | — |
| invoice-paid | PASS | invoice_question | AUTO_REPLY | LLM | — |
| invoice-refunded | FAIL | invoice_question | AUTO_REPLY | DETERMINISTIC_FALLBACK | prompt_LlmDraft, prompt_LlmDraft_first_pass |
| cancellation-eligible | FAIL | cancellation_request | AUTO_REPLY | DETERMINISTIC_FALLBACK | prompt_LlmDraft, prompt_LlmDraft_first_pass |
| cancellation-shipped | FAIL | cancellation_request | AUTO_REPLY | DETERMINISTIC_FALLBACK | prompt_LlmDraft, prompt_LlmDraft_first_pass |
| damaged-item-intake | FAIL | damaged_item | AUTO_REPLY | DETERMINISTIC_FALLBACK | prompt_LlmDraft, prompt_LlmDraft_first_pass |
| damaged-item-window-expired | PASS | damaged_item | HUMAN_ESCALATION | NONE | — |
| cancellation-missing-order | PASS | cancellation_request | ASK_FOR_MORE_INFORMATION | LLM | — |
| cancellation-unresolved-order | FAIL | cancellation_request | ASK_FOR_MORE_INFORMATION | LLM | slot_orderId, prompt_SlotExtraction, prompt_SlotExtraction_first_pass |
| legal-escalation | PASS | cancellation_request | HUMAN_ESCALATION | NONE | — |
| chargeback-escalation | PASS | invoice_question | HUMAN_ESCALATION | NONE | — |
| out-of-scope-careers | PASS | out_of_scope | OUT_OF_SCOPE | NONE | — |
| pii-masked-before-llm | FAIL | cancellation_request | AUTO_REPLY | DETERMINISTIC_FALLBACK | prompt_LlmDraft, prompt_LlmDraft_first_pass |

## Failed Check Details

### invoice-refunded

- prompt_LlmDraft: expected valid versioned JSON output; actual transport_error, version=response-generation/v2.
- prompt_LlmDraft_first_pass: expected valid output with 0 retries; actual transport_error, 0 retries.

### cancellation-eligible

- prompt_LlmDraft: expected valid versioned JSON output; actual transport_error, version=response-generation/v2.
- prompt_LlmDraft_first_pass: expected valid output with 0 retries; actual transport_error, 0 retries.

### cancellation-shipped

- prompt_LlmDraft: expected valid versioned JSON output; actual transport_error, version=response-generation/v2.
- prompt_LlmDraft_first_pass: expected valid output with 0 retries; actual transport_error, 0 retries.

### damaged-item-intake

- prompt_LlmDraft: expected valid versioned JSON output; actual transport_error, version=response-generation/v2.
- prompt_LlmDraft_first_pass: expected valid output with 0 retries; actual transport_error, 0 retries.

### cancellation-unresolved-order

- slot_orderId: expected 99999; actual (missing).
- prompt_SlotExtraction: expected valid versioned JSON output; actual transport_error, version=slot-extraction/v1.
- prompt_SlotExtraction_first_pass: expected valid output with 0 retries; actual transport_error, 0 retries.

### pii-masked-before-llm

- prompt_LlmDraft: expected valid versioned JSON output; actual transport_error, version=response-generation/v2.
- prompt_LlmDraft_first_pass: expected valid output with 0 retries; actual transport_error, 0 retries.

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
