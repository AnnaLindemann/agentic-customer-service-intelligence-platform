/**
 * End-to-end pipeline orchestrator (Phase 8).
 *
 * Composes the existing, individually validated pipeline stages — in the exact documented order
 * (`docs/architecture.md`) — into a single use case: take one raw customer email and produce the
 * canonical Structured JSON Output (`FinalApiResponse`), the passive Phase 7 `AuditRecord`, and a
 * frontend-ready bundle (`WorkbenchResult`) for the Prototype Workbench.
 *
 * It adds **no** business logic and changes no stage: every decision is made by the deterministic
 * Decision Engine, every language task by the LLM stages. Its only "glue" responsibility — beyond
 * calling stages in order — is **slot resolution**: the interpretation stages run on PII-masked
 * text and therefore return masked placeholders (e.g. `[ORDER_ID_1]`), while Structured Data
 * Retrieval and the Business Rule Engine need the real identifiers. The orchestrator resolves the
 * placeholders back to their raw values using the PII Sanitizer's own `detectedPII` map (the
 * masking is reversible only here, in process memory; nothing raw is ever sent to an LLM).
 */
import { randomUUID } from 'node:crypto';
import { config } from '../config/env';
import { demoNow } from '../config/demo-clock';
import { Decision, Intent, Workflow } from '../domain';
import { FinalApiResponseSchema, GeneratedResponseSchema } from '../schemas';
import type {
  AuditRecord,
  AuditStageRecord,
  DetectedPII,
  ExtractedSlots,
  FinalApiResponse,
  GeneratedResponse,
  IntentClassification,
  RetrievedSource,
  StructuredSource,
} from '../types';
import { createLlmClient, type LlmClient } from '../llm';
import {
  enrichWorkflow,
  sanitizePII,
  validateScope,
  type ScopeValidationResult,
} from './customer-email';
import { classifyIntent, extractSlots } from './interpretation';
import {
  detectProductNameInText,
  resolveProduct,
  retrieveEvidence,
  type ProductResolution,
} from './retrieval';
import {
  buildCaseReference,
  detectEscalationTriggers,
  detectOutOfScopeCategory,
  runDecisionEngine,
  type EscalationSignal,
  type OutOfScopeCategory,
} from './decision';
import {
  buildDecisionGuidance,
  buildNextSteps,
  customerNameFromFacts,
  detectLanguage,
  fallbackCustomerReply,
  personalizeGreeting,
  runResponseGeneration,
  type DecisionGuidance,
  type Language,
} from './response';
import {
  buildAuditTrace,
  createLlmCallRecorder,
  instrumentLlmClient,
} from './audit';

/** The complete, frontend-ready result the workbench renders. Every field is read-only data. */
export interface WorkbenchResult {
  caseId: string;
  receivedAt: string;
  /** The email as entered and as masked, with a PII summary (tokens only — never raw values). */
  email: {
    original: string;
    sanitized: string;
    detectedPii: Array<{ type: DetectedPII['type']; maskToken: string }>;
    piiCount: number;
  };
  /** Intent Classification + Top-N Ranking, plus whether the safe fallback was used. */
  intent: IntentClassification & { fallback: boolean };
  scope: ScopeValidationResult;
  /** Extracted slots: present keys, required-but-missing keys, and the (resolved) values. */
  slots: {
    present: string[];
    missing: string[];
    values: ExtractedSlots;
  };
  workflow: Workflow;
  /** Detected customer language; the reply is written in it (logic stays language-independent). */
  language: Language;
  /** Escalation-Trigger Guard result (ADR-014): whether a human-only signal was detected. */
  escalation: EscalationSignal;
  /** Simulated reference generated for an action/intake outcome, when applicable. */
  caseReference?: string;
  /** Retrieved evidence: structured business facts and policy passages with similarity scores. */
  retrieval: {
    structuredFacts: StructuredSource[];
    policyEvidence: RetrievedSource[];
    metadata: Awaited<ReturnType<typeof retrieveEvidence>>['metadata'];
  };
  /** Data Sufficiency Evaluation summary. */
  sufficiency: ReturnType<typeof runDecisionEngine>['evaluation'];
  /** Every deterministic business rule outcome (passed and failed), with human-readable detail. */
  businessRules: ReturnType<typeof runDecisionEngine>['ruleResults'];
  /** The single Decision Gate outcome. */
  decision: ReturnType<typeof runDecisionEngine>['decision'];
  /** Canonical customer response: the draft (or null), generation mode, compliance and evidence. */
  response: GeneratedResponse;
  /** Deterministic "what happened / why / what next / what to do" guidance for the decision. */
  guidance: DecisionGuidance;
  /** The ordered stage timeline. */
  stages: AuditStageRecord[];
  /** The full passive Phase 7 audit record (LLM metadata, totals, evaluation metrics). */
  audit: AuditRecord;
  /** The canonical Structured JSON Output, for the "raw JSON" inspector. */
  final: FinalApiResponse;
}

/**
 * Build a map from mask token (e.g. `[ORDER_ID_1]`) to the raw value it replaced, so the
 * interpretation stages' masked slot values can be resolved for deterministic data lookup.
 */
function buildUnmaskMap(detectedPII: DetectedPII[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of detectedPII) map.set(entry.maskToken, entry.rawValue);
  return map;
}

/** Replace any mask tokens inside a slot value with their raw values. */
function resolveValue(value: string | undefined, unmask: Map<string, string>): string | undefined {
  if (value === undefined) return undefined;
  let resolved = value;
  for (const [token, raw] of unmask) {
    if (resolved.includes(token)) resolved = resolved.split(token).join(raw);
  }
  return resolved;
}

/** Resolve every extracted slot value back to its raw form for retrieval and rules. */
function resolveSlots(slots: ExtractedSlots, unmask: Map<string, string>): ExtractedSlots {
  return {
    orderId: resolveValue(slots.orderId, unmask),
    customerEmail: resolveValue(slots.customerEmail, unmask),
    productName: resolveValue(slots.productName, unmask),
    invoiceId: resolveValue(slots.invoiceId, unmask),
    reason: resolveValue(slots.reason, unmask),
  };
}

/**
 * Bilingual topic hints per workflow, appended to the semantic-retrieval query.
 *
 * The policy PDFs are in English while customer emails are usually German; the local
 * sentence-embedding model under-retrieves across that language gap (a German cancellation email
 * scores far below threshold against the English cancellation policy). Appending a short, neutral
 * topic phrase steers the query to the correct policy section so a *real* passage is retrieved and
 * cited. This is query construction only — the caller's job per ADR-009 — not a hard-coded policy
 * fallback: retrieval still has to find and the reply still has to cite an actual passage, and a
 * genuine miss still falls back safely (ADR-014).
 */
const POLICY_QUERY_HINTS: Partial<Record<Workflow, string>> = {
  [Workflow.CANCELLATION]: 'Stornierung order cancellation cancel processing shipped window',
  [Workflow.DAMAGED_ITEM]: 'Schaden beschädigt damaged defective item return replacement evidence',
  [Workflow.INVOICE]: 'Rechnung invoice billing payment amount due status refund',
  [Workflow.PRODUCT_AVAILABILITY]: 'Verfügbarkeit availability stock product backorder restock',
};

/** Build the semantic-retrieval query: the masked email plus a neutral workflow topic hint. */
function buildPolicyQuery(workflow: Workflow, sanitizedEmail: string): string {
  const hint = POLICY_QUERY_HINTS[workflow];
  return hint ? `${sanitizedEmail}\n\n${hint}` : sanitizedEmail;
}

/** The non-empty slot keys present in an extraction (for the workbench's Slot Extraction card). */
function presentSlotKeys(slots: ExtractedSlots): string[] {
  return Object.entries(slots)
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .map(([key]) => key);
}

/** Construct the instrumented LLM client, or `undefined` if the client cannot be built. */
function buildInstrumentedClient(
  recorder: ReturnType<typeof createLlmCallRecorder>,
): LlmClient | undefined {
  try {
    return instrumentLlmClient(createLlmClient(), recorder, { provider: config.llm.provider });
  } catch {
    // No usable client (e.g. unconfigured provider): stages fall back safely on their own.
    return undefined;
  }
}

/** Options that tune how a single email is processed. */
export interface ProcessEmailOptions {
  /**
   * When true, time-relative business rules are evaluated against the fixed demo clock instead of
   * the real wall clock, so built-in demo scenarios stay reproducible. The Workbench sets this for
   * built-in scenarios only; custom emails use the real time. See `config/demo-clock.ts`.
   */
  demoMode?: boolean;
}

/**
 * Run the full pipeline for one raw customer email and return the workbench bundle.
 *
 * Stage order is fixed and matches `docs/architecture.md`. The function never throws on a
 * stage's safe fallback: an LLM response failure uses a compliant deterministic response when one
 * is available, otherwise no response is delivered. The Decision Gate outcome is never changed.
 */
export async function processEmail(
  rawEmail: string,
  options: ProcessEmailOptions = {},
): Promise<WorkbenchResult> {
  const caseId = `case-${randomUUID().slice(0, 8)}`;
  const receivedAt = new Date().toISOString();
  // Demo scenarios are evaluated against a fixed virtual date so time-relative rules (the 24h
  // cancellation window) stay reproducible; custom emails use the real clock.
  const decisionClock = options.demoMode ? demoNow() : undefined;
  const stages: AuditStageRecord[] = [];
  const recordStage = (stage: string, result: string, reasonCode?: AuditStageRecord['reasonCode']) =>
    stages.push({ stage, result, reasonCode, at: new Date().toISOString() });

  const recorder = createLlmCallRecorder();
  const llm = buildInstrumentedClient(recorder);

  // 1. PII Sanitizer — mask personal data before any LLM call.
  const sanitization = sanitizePII(rawEmail);
  recordStage(
    'PIISanitizer',
    `${sanitization.detectedPII.length} PII element(s) masked`,
    sanitization.detectedPII.length > 0 ? 'PII_DETECTED' : undefined,
  );
  const unmask = buildUnmaskMap(sanitization.detectedPII);

  // 1b. Escalation-Trigger Guard (deterministic, ADR-014) — detect the human-only signals
  //     (dispute / chargeback / goodwill / fraud / legal) on the masked text.
  const escalation = detectEscalationTriggers(sanitization.sanitizedEmail);
  recordStage(
    'EscalationTriggerScan',
    escalation.triggered ? `trigger: ${escalation.category}` : 'no trigger',
    escalation.triggered ? 'ESCALATION_REQUIRED' : undefined,
  );

  // 1c. Language detection (deterministic) — reply in the customer's language. The signal never
  //     affects retrieval, rules or the decision; only the customer-facing text.
  const language: Language = detectLanguage(sanitization.sanitizedEmail);
  recordStage('LanguageDetection', language);

  // 2. Intent Classification + Top-N Ranking (LLM).
  const intentOutcome = await classifyIntent({ sanitizedEmail: sanitization.sanitizedEmail }, llm);
  const classification = intentOutcome.classification;
  recordStage('IntentClassification', classification.intent);

  // 3. Scope Validation (deterministic).
  const scope = validateScope(classification.intent);
  recordStage('ScopeValidation', scope.status, scope.reasonCode);

  // 4. Slot Extraction (LLM).
  const slotOutcome = await extractSlots({ sanitizedEmail: sanitization.sanitizedEmail }, llm);
  // Copy so deterministic slot recovery below does not mutate the audit's record of what the LLM
  // actually extracted (the audit reads `slotOutcome.extraction`).
  const maskedSlots = { ...slotOutcome.extraction.slots };
  const resolvedSlots = resolveSlots(slotOutcome.extraction.slots, unmask);
  recordStage('SlotExtraction', `${presentSlotKeys(maskedSlots).length} slot(s) found`);

  // 4b. Deterministic product-name recovery. Availability questions need a product, but the LLM
  //     slot extractor occasionally misses an obvious mention (e.g. "Vista 45L Backpack"). When
  //     that happens, recover the product name from the masked email against the catalogue using
  //     the same deterministic fuzzy logic — no extra LLM call, no PII (product names are not PII).
  if (
    classification.intent === Intent.PRODUCT_AVAILABILITY &&
    (maskedSlots.productName === undefined || maskedSlots.productName.trim().length === 0)
  ) {
    const recovered = detectProductNameInText(sanitization.sanitizedEmail);
    if (recovered) {
      maskedSlots.productName = recovered;
      resolvedSlots.productName = recovered;
      recordStage('ProductNameRecovery', recovered);
    }
  }

  // 5. Workflow Enrichment (deterministic).
  const enrichment = enrichWorkflow({
    intent: classification.intent,
    scope,
    slots: maskedSlots,
  });
  recordStage('WorkflowEnrichment', enrichment.workflow);

  // 5b. Case Intake (deterministic, ADR-014) — mint a simulated case reference for action/intake
  //     workflows once the order id is resolved (cancellation → CXL-…, damaged item → RMA-…).
  const caseReference = buildCaseReference(enrichment.workflow, resolvedSlots);
  if (caseReference) recordStage('CaseIntake', `simulated reference ${caseReference} generated`);

  // 6/7. Hybrid Retrieval — Structured Data + Semantic PDF (deterministic + local embeddings).
  const retrieval = await retrieveEvidence(
    {
      caseId,
      slots: resolvedSlots,
      query: buildPolicyQuery(enrichment.workflow, sanitization.sanitizedEmail),
    },
    // Retrieve a few more passages than the default so a grounded reply can cite both the
    // eligibility section and the related outcome section (e.g. refund-on-cancellation) of a
    // policy. Still a real similarity-ranked retrieval — no hard-coded policy text (ADR-014).
    { topN: 5 },
  );
  recordStage(
    'HybridRetrieval',
    `${retrieval.structuredFacts.length} fact(s), ${retrieval.policyEvidence.length} policy passage(s)`,
  );

  // Product resolution (deterministic): when an availability question names a product, classify it
  // as resolved / ambiguous / under-specified / not_found so the gate can answer a not-found
  // catalogue query automatically instead of asking for information that was never missing.
  const productName = resolvedSlots.productName?.trim();
  const productResolution: ProductResolution | undefined =
    enrichment.workflow === Workflow.PRODUCT_AVAILABILITY && productName
      ? resolveProduct(productName)
      : undefined;
  if (productResolution) recordStage('ProductResolution', productResolution.status);
  const productCandidates =
    productResolution?.status === 'ambiguous' ? productResolution.candidates : undefined;

  // 8/9/10. Decision Engine — Data Sufficiency, Business Rules, Decision Gate (deterministic).
  const decisionEngine = runDecisionEngine({
    caseId,
    workflow: enrichment.workflow,
    intent: classification.intent,
    slots: resolvedSlots,
    missingInformation: enrichment.missingInformation,
    structuredFacts: retrieval.structuredFacts,
    policyEvidence: retrieval.policyEvidence,
    rankedIntents: classification.ranked,
    escalationSignal: escalation,
    productResolution: productResolution?.status,
    now: decisionClock,
  });
  if (decisionClock) recordStage('DemoClock', decisionClock.toISOString());
  recordStage(
    'DataSufficiency',
    decisionEngine.evaluation.sufficient ? 'sufficient' : 'insufficient',
    decisionEngine.evaluation.reasonCode,
  );
  recordStage(
    'BusinessRuleEngine',
    `${decisionEngine.ruleResults.filter((r) => r.passed).length}/${decisionEngine.ruleResults.length} passed`,
  );
  recordStage('DecisionGate', decisionEngine.decision.decision, decisionEngine.decision.reasonCode);

  // When out of scope, classify the subtype deterministically so the reply redirects correctly
  // (careers / business contact / a plain scope explanation) rather than always to careers.
  const outOfScopeCategory: OutOfScopeCategory | undefined =
    decisionEngine.decision.decision === Decision.OUT_OF_SCOPE
      ? detectOutOfScopeCategory(sanitization.sanitizedEmail)
      : undefined;
  if (outOfScopeCategory) recordStage('OutOfScopeClassification', outOfScopeCategory);

  // Deterministic, grounded next-step guidance (improvement set). Computed once from the decided
  // case and reused both as authoritative content for the LLM draft and for the deterministic
  // fallback reply, so the business next step is identical regardless of which path produces text.
  const actionEligible = decisionEngine.ruleResults.every((rule) => rule.passed);
  const nextSteps = buildNextSteps({
    decision: decisionEngine.decision.decision,
    workflow: enrichment.workflow,
    language,
    reasonCode: decisionEngine.decision.reasonCode,
    structuredFacts: retrieval.structuredFacts,
    ruleResults: decisionEngine.ruleResults,
    missingInformation: enrichment.missingInformation,
    caseReference,
    actionEligible,
    escalationCategory: escalation.category,
    outOfScopeCategory,
    productResolution: productResolution?.status,
    productQuery: productName,
    productCandidates,
  });

  // Build the deterministic fallback before response generation. It becomes customer-visible only
  // if the LLM fails and the Response Generator validates it into the canonical response object.
  const deterministicFallbackDraft =
    decisionEngine.decision.decision === Decision.AUTO_REPLY ||
    decisionEngine.decision.decision === Decision.ASK_FOR_MORE_INFORMATION
      ? fallbackCustomerReply({
          decision: decisionEngine.decision.decision,
          workflow: enrichment.workflow,
          reasonCode: decisionEngine.decision.reasonCode,
          missingInformation: enrichment.missingInformation,
          caseReference,
          escalationCategory: escalation.category,
          outOfScopeCategory,
          productResolution: productResolution?.status,
          productQuery: productName,
          productCandidates,
          actionEligible,
          language,
          structuredFacts: retrieval.structuredFacts,
          ruleResults: decisionEngine.ruleResults,
        })
      : undefined;

  // 11/12. Response Generator + Compliance Validation (LLM or deterministic canonical response).
  let response = await runResponseGeneration(
    {
      caseId,
      decision: decisionEngine.decision,
      intent: classification.intent,
      workflow: enrichment.workflow,
      sanitizedEmail: sanitization.sanitizedEmail,
      missingInformation: enrichment.missingInformation,
      structuredFacts: retrieval.structuredFacts,
      policyEvidence: retrieval.policyEvidence,
      ruleResults: decisionEngine.ruleResults,
      caseReference,
      language,
      nextSteps,
      deterministicFallbackDraft,
      detectedPiiValues: sanitization.detectedPII.map((p) => p.rawValue),
    },
    llm,
  );
  recordStage('ResponseGenerator', response.delivered ? 'draft delivered' : 'no draft');
  recordStage(
    'ComplianceValidation',
    response.compliance.passed ? 'passed' : 'failed',
    response.compliance.reasonCode,
  );

  // Deterministic customer guidance (ADR-014). Drives the Workbench "why / next action" panels and
  // explains the decided case independently of how the canonical response was generated.
  const guidance = buildDecisionGuidance({
    decision: decisionEngine.decision.decision,
    workflow: enrichment.workflow,
    reasonCode: decisionEngine.decision.reasonCode,
    missingInformation: enrichment.missingInformation,
    caseReference,
    escalationCategory: escalation.category,
    outOfScopeCategory,
    productResolution: productResolution?.status,
    productQuery: productName,
    productCandidates,
    actionEligible,
  });
  // The delivered draft is PII-masked (it was generated from, and compliance-checked against,
  // masked text). In the canonical response we resolve any residual mask placeholders back
  // to the customer's own identifiers using the in-process unmask map — the same reversible step
  // the orchestrator already performs for retrieval. No unmasked PII is ever sent to an LLM, so
  // ADR-004 holds; this only restores the customer's own order/invoice number in their own reply.
  if (response.delivered && response.draft) {
    const resolvedDraft = resolveValue(response.draft, unmask) ?? response.draft;
    // Deterministically personalise the canonical response after compliance. The customer's own
    // name is retrieved locally and is never sent to the LLM (ADR-004).
    const customerName = customerNameFromFacts(retrieval.structuredFacts);
    response = GeneratedResponseSchema.parse({
      ...response,
      draft: personalizeGreeting(resolvedDraft, language, customerName),
    });
  }

  // 13. Audit & Evaluation — passive Phase 7 record (never alters anything above).
  const audit = buildAuditTrace({
    caseId,
    llm: recorder.entries(),
    classification,
    slots: slotOutcome.extraction,
    workflow: enrichment.workflow,
    decisionEngine,
    response,
    stages,
  });

  // Canonical Structured JSON Output.
  const final = FinalApiResponseSchema.parse({
    caseId,
    decision: decisionEngine.decision.decision,
    intent: classification.intent,
    workflow: enrichment.workflow,
    riskLevel: decisionEngine.decision.riskLevel,
    reasonCode: decisionEngine.decision.reasonCode,
    draft: response.draft,
    evidence: {
      structured: retrieval.structuredFacts,
      policies: retrieval.policyEvidence,
    },
    evaluation: decisionEngine.evaluation,
    audit: { caseId, stages },
  });

  return {
    caseId,
    receivedAt,
    email: {
      original: rawEmail,
      sanitized: sanitization.sanitizedEmail,
      detectedPii: sanitization.detectedPII.map((p) => ({ type: p.type, maskToken: p.maskToken })),
      piiCount: sanitization.detectedPII.length,
    },
    intent: { ...classification, fallback: intentOutcome.fallback },
    scope,
    slots: {
      present: presentSlotKeys(maskedSlots),
      missing: enrichment.missingInformation,
      values: resolvedSlots,
    },
    workflow: enrichment.workflow,
    language,
    escalation,
    caseReference,
    retrieval: {
      structuredFacts: retrieval.structuredFacts,
      policyEvidence: retrieval.policyEvidence,
      metadata: retrieval.metadata,
    },
    sufficiency: decisionEngine.evaluation,
    businessRules: decisionEngine.ruleResults,
    decision: decisionEngine.decision,
    response,
    guidance,
    stages,
    audit,
    final,
  };
}
