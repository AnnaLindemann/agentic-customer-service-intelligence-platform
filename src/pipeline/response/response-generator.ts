/**
 * Response Generator — Phase 6 entry point.
 *
 * Turns a *completed* Decision Gate outcome plus grounded evidence into the Structured JSON
 * Output (`GeneratedResponse`). It never makes or changes a business decision (ADR-001): the
 * decision is carried through unchanged; this stage only produces the customer-facing German
 * text and routes it through deterministic Compliance Validation.
 *
 * Flow:
 *   - HUMAN_ESCALATION  → no LLM call; no draft (a human handles the case).
 *   - AUTO_REPLY / ASK_FOR_MORE_INFORMATION → build a PII-safe prompt, generate JSON (one retry
 *     on invalid JSON inside the LLM layer), then run Compliance Validation. A draft is
 *     delivered only when it passes; otherwise the safe fallback is no draft (human handling).
 *   - Any LLM failure → safe fallback (no draft), never a raw or unchecked message.
 *
 * The LLM client is injected so the stage stays provider-neutral and unit-testable.
 */
import { Decision, ReasonCode } from '../../domain';
import { GeneratedResponseSchema } from '../../schemas';
import type {
  CitedEvidence,
  BusinessRuleResult,
  DecisionResult,
  GeneratedResponse,
  Intent,
  RetrievedSource,
  StructuredSource,
  Workflow,
} from '../../types';
import { createLlmClient, LlmError, type LlmClient } from '../../llm';
import { LlmDraftSchema } from '../../schemas';
import {
  buildResponsePrompt,
  collectStructuredPiiValues,
  RESPONSE_PROMPT_VERSION,
} from './prompt';
import { validateCompliance } from './compliance-validation';
import { containsUnmaskedPII } from '../customer-email';
import type { PreparedResponseEvidence } from './prompt';
import type { Language } from './language';

export interface ResponseGenerationInput {
  caseId?: string;
  /** The Decision Gate outcome, echoed unchanged into the result. */
  decision: DecisionResult;
  intent: Intent;
  workflow: Workflow;
  /** PII-masked email body (never the raw email). */
  sanitizedEmail: string;
  missingInformation: string[];
  structuredFacts: StructuredSource[];
  policyEvidence: RetrievedSource[];
  /** Passed/failed deterministic rules used only as grounding context; never changed here. */
  ruleResults?: BusinessRuleResult[];
  /** Simulated case reference (ADR-014) to quote in the reply, when a case was opened. */
  caseReference?: string;
  /** Customer-facing language detected from the email (German or English). Defaults to German. */
  language?: Language;
  /** Deterministic, grounded next-step lines the draft should convey. */
  nextSteps?: string[];
  /** Raw PII values detected in the email; used by the compliance leak check. */
  detectedPiiValues?: string[];
}

/** Map cited references to their evidence source, dropping any that do not resolve. */
function resolveCitedEvidence(
  citedRefs: string[],
  structuredFacts: StructuredSource[],
  policyEvidence: RetrievedSource[],
): CitedEvidence[] {
  const structuredRefs = new Set(structuredFacts.map((f) => f.ref));
  const policyRefs = new Set(policyEvidence.map((p) => p.ref));
  const seen = new Set<string>();
  const evidence: CitedEvidence[] = [];
  for (const ref of citedRefs) {
    if (seen.has(ref)) continue;
    if (structuredRefs.has(ref)) {
      evidence.push({ ref, source: 'structured' });
      seen.add(ref);
    } else if (policyRefs.has(ref)) {
      evidence.push({ ref, source: 'policy' });
      seen.add(ref);
    }
  }
  return evidence;
}

/**
 * Generate the customer-facing response for a decided case.
 *
 * @param llm Optional client; defaults to the configured provider. Injectable for tests.
 */
export async function runResponseGeneration(
  input: ResponseGenerationInput,
  llm?: LlmClient,
): Promise<GeneratedResponse> {
  const { decision } = input;
  const language: Language = input.language ?? 'de';

  // No LLM draft is generated for human escalation (a person replies) or out-of-scope (the
  // customer receives a deterministic redirect). The orchestrator supplies the customer-facing
  // text in both cases; the LLM is not involved.
  if (
    decision.decision === Decision.HUMAN_ESCALATION ||
    decision.decision === Decision.OUT_OF_SCOPE
  ) {
    const detail =
      decision.decision === Decision.HUMAN_ESCALATION
        ? 'Human escalation — no customer draft generated.'
        : 'Out of scope — deterministic redirect, no draft generated.';
    return GeneratedResponseSchema.parse({
      caseId: input.caseId,
      language,
      promptVersion: RESPONSE_PROMPT_VERSION,
      decision,
      draft: null,
      delivered: false,
      citedEvidence: [],
      compliance: {
        passed: true,
        checks: [{ name: 'no_draft_required', passed: true, detail }],
      },
    });
  }

  // Generate the draft. An LLM failure becomes a safe fallback (no draft → human handling).
  let reply: string;
  let citedRefs: string[];
  let promptEvidence: PreparedResponseEvidence;
  try {
    if (containsUnmaskedPII(input.sanitizedEmail)) throw new Error('Input is not PII-masked.');
    const prompt = buildResponsePrompt({
      decision: decision.decision,
      intent: input.intent,
      workflow: input.workflow,
      sanitizedEmail: input.sanitizedEmail,
      missingInformation: input.missingInformation,
      structuredFacts: input.structuredFacts,
      policyEvidence: input.policyEvidence,
      ruleResults: input.ruleResults,
      caseReference: input.caseReference,
      language,
      nextSteps: input.nextSteps,
    });
    const client = llm ?? createLlmClient();
    const result = await client.generateJson(
      {
        system: prompt.system,
        user: prompt.user,
        schemaName: `LlmDraft@${RESPONSE_PROMPT_VERSION}`,
      },
      LlmDraftSchema,
    );
    reply = result.data.reply;
    citedRefs = result.data.citedRefs;
    promptEvidence = prompt.evidence;
  } catch (error) {
    const reasonCode =
      error instanceof LlmError && error.kind === 'invalid_output'
        ? ReasonCode.INVALID_LLM_OUTPUT
        : ReasonCode.ESCALATION_REQUIRED;
    return GeneratedResponseSchema.parse({
      caseId: input.caseId,
      language,
      promptVersion: RESPONSE_PROMPT_VERSION,
      decision,
      draft: null,
      delivered: false,
      citedEvidence: [],
      compliance: {
        passed: false,
        reasonCode,
        checks: [
          {
            name: 'llm_generation',
            passed: false,
            detail: 'Response generation failed; routed to human handling.',
          },
        ],
      },
    });
  }

  // Deterministic compliance gate.
  const piiValues = [
    ...(input.detectedPiiValues ?? []),
    ...collectStructuredPiiValues(input.structuredFacts),
  ];
  const compliance = validateCompliance({
    decision: decision.decision,
    draft: reply,
    citedRefs,
    structuredFacts: promptEvidence.structuredFacts,
    policyEvidence: promptEvidence.policyEvidence,
    ruleResults: input.ruleResults,
    piiValues,
    language,
  });

  const delivered = compliance.passed;
  return GeneratedResponseSchema.parse({
    caseId: input.caseId,
    language,
    promptVersion: RESPONSE_PROMPT_VERSION,
    decision,
    // Only a compliant draft is delivered; otherwise the safe fallback is no draft.
    draft: delivered ? reply : null,
    delivered,
    citedEvidence: delivered
      ? resolveCitedEvidence(citedRefs, promptEvidence.structuredFacts, promptEvidence.policyEvidence)
      : [],
    compliance,
  });
}
