/** PII-safe, versioned prompt construction for response generation. */
import type {
  BusinessRuleResult,
  Decision,
  Intent,
  RetrievedSource,
  StructuredSource,
  Workflow,
} from '../../types';

export const RESPONSE_PROMPT_VERSION = 'response-generation/v1';

const PII_KEYS = new Set(
  [
    'customerEmail',
    'customerName',
    'email',
    'phone',
    'telephone',
    'shippingAddress',
    'billingAddress',
    'address',
    'paymentMethod',
    'customerId',
  ].map((key) => key.toLowerCase()),
);

const SAFE_TOP_LEVEL_FIELDS: Record<StructuredSource['kind'], readonly string[]> = {
  customer: [],
  order: [
    'status',
    'placedAt',
    'shippedAt',
    'deliveredAt',
    'cancelledAt',
    'returnedAt',
    'shippingMethod',
    'items',
    'currency',
    'subtotal',
    'shipping',
    'tax',
    'total',
  ],
  invoice: [
    'status',
    'issueDate',
    'dueDate',
    'paidDate',
    'refundDate',
    'currency',
    'subtotal',
    'shipping',
    'tax',
    'total',
    'amountPaid',
    'amountRefunded',
    'amountDue',
  ],
  product: [
    'sku',
    'name',
    'category',
    'description',
    'price',
    'currency',
    'availability',
    'quantityOnHand',
    'lowStockThreshold',
    'restockDate',
    'discontinued',
  ],
};

function isPiiKey(key: string): boolean {
  return PII_KEYS.has(key.toLowerCase());
}

function safeOrderItems(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (item === null || typeof item !== 'object') return {};
    const record = item as Record<string, unknown>;
    return Object.fromEntries(
      ['sku', 'name', 'quantity', 'unitPrice']
        .filter((key) => key in record)
        .map((key) => [key, record[key]]),
    );
  });
}

/** Copy only explicitly approved business fields; unknown fields are excluded by default. */
function whitelistStructuredData(fact: StructuredSource): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of SAFE_TOP_LEVEL_FIELDS[fact.kind]) {
    if (!(key in fact.data)) continue;
    output[key] = key === 'items' ? safeOrderItems(fact.data[key]) : fact.data[key];
  }
  return output;
}

function redactContactPatterns(text: string): string {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[REDACTED_EMAIL]')
    .replace(/\b(?:CUST(?:OMER)?|KUND(?:E|EN))[-_]?[A-Z0-9]{3,}\b/giu, '[REDACTED_CUSTOMER_ID]')
    .replace(/(?<![\w[])\+?\d(?:[\d ().-]{6,}\d)(?![\w\]])/gu, (match) =>
      /^\d{1,4}[.-]\d{1,2}[.-]\d{2,4}$/.test(match) ? match : '[REDACTED_PHONE]',
    );
}

function collectPrimitiveValues(node: unknown, out: string[]): void {
  if (node === null || node === undefined) return;
  if (typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>)) {
      collectPrimitiveValues(value, out);
    }
    return;
  }
  const text = String(node).trim();
  if (text.length > 0) out.push(text);
}

function collectPiiValues(node: unknown, out: string[]): void {
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (isPiiKey(key)) collectPrimitiveValues(value, out);
    else collectPiiValues(value, out);
  }
}

/** Values removed by the whitelist, used only by the deterministic output leak check. */
export function collectStructuredPiiValues(facts: StructuredSource[]): string[] {
  const values: string[] = [];
  for (const fact of facts) collectPiiValues(fact.data, values);
  return values;
}

export interface PreparedResponseEvidence {
  structuredFacts: StructuredSource[];
  policyEvidence: RetrievedSource[];
}

/**
 * Replace original references with non-identifying, per-prompt aliases and whitelist fact data.
 * The aliases are also the only references accepted from the model and returned to consumers.
 */
export function prepareResponseEvidence(
  structuredFacts: StructuredSource[],
  policyEvidence: RetrievedSource[],
): PreparedResponseEvidence {
  return {
    structuredFacts: structuredFacts.map((fact, index) => ({
      ref: `structured:${fact.kind}:${index + 1}`,
      kind: fact.kind,
      data: whitelistStructuredData(fact),
    })),
    policyEvidence: policyEvidence.map((passage, index) => ({
      ref: `policy:${index + 1}`,
      snippet: redactContactPatterns(passage.snippet),
      score: passage.score,
    })),
  };
}

export interface ResponsePromptInput {
  decision: Decision;
  intent: Intent;
  workflow: Workflow;
  sanitizedEmail: string;
  missingInformation: string[];
  structuredFacts: StructuredSource[];
  policyEvidence: RetrievedSource[];
  ruleResults?: BusinessRuleResult[];
}

const SYSTEM_PROMPT = [
  'Du bist ein Kundenservice-Assistent eines Online-Händlers. Du verfasst die Antwort an die',
  'Kundin oder den Kunden ausschließlich auf Deutsch, höflich und in der Sie-Form.',
  '',
  'Strikte Regeln:',
  '- Verwende ausschließlich die bereitgestellten Fakten, bestandenen Regeln und Richtlinien.',
  '- Erfinde keine Bestelldaten, Beträge, Fristen, Namen oder Sachverhalte.',
  '- Triff keine Zusagen, die nicht ausdrücklich durch die Belege oder bestandenen Regeln gestützt sind.',
  '- Ändere die getroffene Entscheidung nicht; formuliere ausschließlich den Antworttext.',
  '- Bei ASK_FOR_MORE_INFORMATION: bitte genau um die fehlenden Informationen.',
  '- Gib keine personenbezogenen Daten oder maskierten Platzhalter aus.',
  '- Nenne in "citedRefs" mindestens eine tatsächlich verwendete Referenz.',
  '',
  'Antworte ausschließlich mit einem JSON-Objekt in genau diesem Format:',
  '{"reply": "<deutsche Antwort>", "citedRefs": ["<ref>", ...]}',
].join('\n');

export interface BuiltResponsePrompt {
  system: string;
  user: string;
  evidence: PreparedResponseEvidence;
}

export function buildResponsePrompt(input: ResponsePromptInput): BuiltResponsePrompt {
  const evidence = prepareResponseEvidence(input.structuredFacts, input.policyEvidence);
  const factLines = evidence.structuredFacts.map(
    (fact) => `- ${fact.ref} (${fact.kind}): ${JSON.stringify(fact.data)}`,
  );
  const policyLines = evidence.policyEvidence.map(
    (passage) => `- ${passage.ref}: "${passage.snippet}"`,
  );
  const passedRules = (input.ruleResults ?? []).filter((rule) => rule.passed).map((rule) => rule.ruleId);

  return {
    system: SYSTEM_PROMPT,
    user: [
      `ENTSCHEIDUNG: ${input.decision}`,
      `INTENT: ${input.intent}`,
      `WORKFLOW: ${input.workflow}`,
      `FEHLENDE INFORMATIONEN: ${input.missingInformation.join(', ') || '(keine)'}`,
      `BESTANDENE REGELN: ${passedRules.join(', ') || '(keine)'}`,
      '',
      'KUNDEN-E-MAIL (maskiert):',
      input.sanitizedEmail || '(kein Text)',
      '',
      'STRUKTURIERTE FAKTEN:',
      factLines.join('\n') || '(keine)',
      '',
      'RICHTLINIEN-AUSZÜGE:',
      policyLines.join('\n') || '(keine)',
    ].join('\n'),
    evidence,
  };
}
