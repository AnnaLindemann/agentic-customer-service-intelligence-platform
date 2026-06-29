/**
 * Safe live smoke test for the Phase 6 Groq integration.
 *
 * The script deliberately uses only PII-masked fixtures and prints neither prompts nor model
 * completions. Live calls go through createLlmClient() and the production interpretation and
 * response stages. The retry check is deterministic so it does not depend on persuading a live
 * model to emit invalid output or consume an unnecessary paid request.
 */
import { z } from 'zod';
import { config } from '../config/env';
import { Decision, Intent, ReasonCode, RiskLevel, Workflow } from '../domain';
import { createLlmClient } from '../llm';
import {
  createOpenAiCompatibleClient,
  type CompletionCreate,
} from '../llm/providers/openai-compatible';
import { classifyIntent, extractSlots } from '../pipeline/interpretation';
import { containsUnmaskedPII } from '../pipeline/customer-email';
import { isLikelyGerman, runResponseGeneration } from '../pipeline/response';
import {
  GeneratedResponseSchema,
  IntentClassificationSchema,
  SlotExtractionSchema,
} from '../schemas';

const MASKED_EMAIL =
  'Guten Tag, ist die Nordlicht-Lampe derzeit verfügbar? Bitte antworten Sie an [EMAIL_1].';

class SmokeFailure extends Error {}

function requireCheck(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SmokeFailure(message);
}

function pass(check: string): void {
  console.log(`PASS  ${check}`);
}

/** Verify the adapter retries malformed and schema-invalid JSON exactly once. */
async function verifyRetryPolicy(): Promise<void> {
  for (const firstResponse of ['not-json', '{"wrong":true}']) {
    let calls = 0;
    const completionCreate: CompletionCreate = async () => {
      calls += 1;
      return {
        choices: [{ message: { content: calls === 1 ? firstResponse : '{"ok":true}' } }],
        model: 'deterministic-retry-probe',
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      };
    };
    const client = createOpenAiCompatibleClient({
      apiKey: 'deterministic-local-probe',
      baseUrl: 'https://unused.invalid/v1',
      model: 'deterministic-retry-probe',
      temperature: 0,
      maxOutputTokens: 10,
      timeoutMs: 1_000,
      providerLabel: 'deterministic-retry-probe',
      completionCreate,
    });

    const result = await client.generateJson(
      { system: 'local probe', user: 'local probe', schemaName: 'RetryProbe' },
      z.object({ ok: z.literal(true) }),
    );
    requireCheck(result.data.ok && calls === 2, 'retry policy did not make exactly two attempts');
  }
  pass('malformed and schema-invalid output retry policy (deterministic, no network)');
}

async function run(): Promise<void> {
  requireCheck(config.llm.provider === 'groq', 'LLM_PROVIDER must be groq');
  requireCheck(Boolean(config.llm.apiKey?.trim()), 'GROQ_API_KEY is missing or empty');
  requireCheck(!containsUnmaskedPII(MASKED_EMAIL), 'smoke fixture failed the PII guard');
  pass('configuration and masked fixture safety');

  await verifyRetryPolicy();

  const llm = createLlmClient();

  const intent = await classifyIntent({ sanitizedEmail: MASKED_EMAIL }, llm);
  requireCheck(!intent.fallback, 'intent classification used its safe fallback');
  const classification = IntentClassificationSchema.parse(intent.classification);
  requireCheck(
    classification.intent === Intent.PRODUCT_AVAILABILITY,
    'intent classification did not identify product availability',
  );
  requireCheck(classification.ranked.length >= 2, 'top-N ranking returned fewer than two intents');
  requireCheck(
    classification.ranked[0]?.intent === classification.intent,
    'top-ranked intent does not match the classification',
  );
  requireCheck(
    classification.ranked.every(
      (candidate, index, ranked) =>
        index === 0 || ranked[index - 1]!.confidence >= candidate.confidence,
    ),
    'intent candidates are not ranked by descending confidence',
  );
  pass('live intent classification, top-N ranking, JSON parse and Zod validation');

  const slots = await extractSlots({ sanitizedEmail: MASKED_EMAIL }, llm);
  requireCheck(!slots.fallback, 'slot extraction used its safe fallback');
  const extraction = SlotExtractionSchema.parse(slots.extraction);
  requireCheck(
    extraction.slots.customerEmail === '[EMAIL_1]',
    'slot extraction did not preserve the masked e-mail token',
  );
  requireCheck(Boolean(extraction.slots.productName), 'slot extraction omitted the product name');
  pass('live slot extraction, JSON parse and Zod validation');

  const response = await runResponseGeneration(
    {
      caseId: 'llm-smoke-safe-fixture',
      decision: {
        decision: Decision.AUTO_REPLY,
        riskLevel: RiskLevel.LOW,
        reasonCode: ReasonCode.AUTO_REPLY_ALLOWED,
        rationale: 'Deterministic safe fixture with current inventory and policy evidence.',
      },
      intent: Intent.PRODUCT_AVAILABILITY,
      workflow: Workflow.PRODUCT_AVAILABILITY,
      sanitizedEmail: MASKED_EMAIL,
      missingInformation: [],
      structuredFacts: [
        {
          ref: 'fixture:product:nordlicht-lampe',
          kind: 'product',
          data: {
            sku: 'SAFE-SMOKE-001',
            name: 'Nordlicht-Lampe',
            availability: 'in_stock',
            quantityOnHand: 12,
          },
        },
      ],
      policyEvidence: [
        {
          ref: 'fixture:policy:availability',
          snippet:
            'Verfügbarkeitsauskünfte dürfen anhand des aktuellen Lagerstatus erteilt werden. ' +
            'Als verfügbar markierte Produkte dürfen als verfügbar bestätigt werden.',
          score: 1,
        },
      ],
      ruleResults: [
        {
          ruleId: 'product_availability.in_stock',
          passed: true,
          riskLevel: RiskLevel.LOW,
          reasonCode: ReasonCode.RULE_PASSED,
        },
      ],
    },
    llm,
  );
  const validatedResponse = GeneratedResponseSchema.parse(response);
  requireCheck(validatedResponse.delivered, 'response generation did not deliver a draft');
  requireCheck(validatedResponse.compliance.passed, 'valid grounded response failed compliance');
  requireCheck(
    validatedResponse.draft !== null && isLikelyGerman(validatedResponse.draft),
    'generated response was not confidently German',
  );
  requireCheck(
    validatedResponse.citedEvidence.length > 0,
    'generated response did not cite grounded evidence',
  );
  pass('live grounded German response generation and deterministic compliance');

  console.log('LLM smoke test passed. No prompt or completion bodies were printed.');
}

run().catch((error: unknown) => {
  if (error instanceof SmokeFailure) {
    console.error(`FAIL  ${error.message}`);
  } else {
    // Do not serialize unknown errors: SDK errors may contain request metadata.
    console.error('FAIL  unexpected smoke-test error (details intentionally suppressed)');
  }
  process.exitCode = 1;
});
