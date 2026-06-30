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
 *     on invalid JSON inside the LLM layer), then run Compliance Validation.
 *   - LLM failure → validate the supplied deterministic fallback through the same compliance gate.
 *     It becomes the canonical delivered response only when safe; otherwise no response is delivered.
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
  prepareResponseEvidence,
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
  /** Simulated reference (ADR-014) to quote without implying an external ticket was created. */
  caseReference?: string;
  /** Customer-facing language detected from the email (German or English). Defaults to German. */
  language?: Language;
  /** Deterministic, grounded next-step lines the draft should convey. */
  nextSteps?: string[];
  /** Prebuilt deterministic customer message used only when LLM generation fails. */
  deterministicFallbackDraft?: string;
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

/** Validate and package the prebuilt deterministic fallback as the canonical response. */
function deterministicFallbackResponse(
  input: ResponseGenerationInput,
  language: Language,
): GeneratedResponse | undefined {
  const draft = input.deterministicFallbackDraft?.trim();
  if (!draft) return undefined;

  const evidence = prepareResponseEvidence(input.structuredFacts, input.policyEvidence);
  const citedRefs = [
    ...evidence.structuredFacts.map((fact) => fact.ref),
    ...evidence.policyEvidence.map((passage) => passage.ref),
  ];
  const compliance = validateCompliance({
    decision: input.decision.decision,
    workflow: input.workflow,
    draft,
    citedRefs,
    structuredFacts: evidence.structuredFacts,
    policyEvidence: evidence.policyEvidence,
    ruleResults: input.ruleResults,
    piiValues: [
      ...(input.detectedPiiValues ?? []),
      ...collectStructuredPiiValues(input.structuredFacts),
    ],
    language,
  });
  const delivered = compliance.passed;
  return GeneratedResponseSchema.parse({
    caseId: input.caseId,
    language,
    promptVersion: RESPONSE_PROMPT_VERSION,
    generationMode: 'DETERMINISTIC_FALLBACK',
    decision: input.decision,
    draft: delivered ? draft : null,
    delivered,
    citedEvidence: delivered
      ? resolveCitedEvidence(citedRefs, evidence.structuredFacts, evidence.policyEvidence)
      : [],
    compliance,
  });
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
      generationMode: 'NONE',
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

  // Generate the draft. On failure, a deterministic fallback must pass compliance before delivery.
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
    const fallback = deterministicFallbackResponse(input, language);
    if (fallback) return fallback;

    const reasonCode = ReasonCode.INVALID_LLM_OUTPUT;
    return GeneratedResponseSchema.parse({
      caseId: input.caseId,
      language,
      promptVersion: RESPONSE_PROMPT_VERSION,
      generationMode: 'NONE',
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
            detail: `Response generation failed (${error instanceof LlmError ? error.kind : 'unknown'}); no safe fallback response was available.`,
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
    workflow: input.workflow,
    draft: reply,
    citedRefs,
    structuredFacts: promptEvidence.structuredFacts,
    policyEvidence: promptEvidence.policyEvidence,
    ruleResults: input.ruleResults,
    piiValues,
    language,
  });

  if (!compliance.passed) {
    const fallback = deterministicFallbackResponse(input, language);
    if (fallback) return fallback;
  }

  const delivered = compliance.passed;
  return GeneratedResponseSchema.parse({
    caseId: input.caseId,
    language,
    promptVersion: RESPONSE_PROMPT_VERSION,
    generationMode: 'LLM',
    decision,
    // Only a compliant LLM draft is delivered.
    draft: delivered ? reply : null,
    delivered,
    citedEvidence: delivered
      ? resolveCitedEvidence(citedRefs, promptEvidence.structuredFacts, promptEvidence.policyEvidence)
      : [],
    compliance,
  });
}
