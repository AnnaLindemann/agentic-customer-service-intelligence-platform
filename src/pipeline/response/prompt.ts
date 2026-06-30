/** PII-safe, versioned prompt construction for response generation. */
import type {
  BusinessRuleResult,
  Decision,
  Intent,
  RetrievedSource,
  StructuredSource,
  Workflow,
} from '../../types';
import type { Language } from './language';

export const RESPONSE_PROMPT_VERSION = 'response-generation/v2';

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
  /** Simulated reference the reply may quote without implying an external ticket was created. */
  caseReference?: string;
  /** Customer-facing language the reply must be written in. */
  language: Language;
  /** Deterministic, grounded next-step lines the draft must convey (from `buildNextSteps`). */
  nextSteps?: string[];
}

const SYSTEM_PROMPT_DE = [
  'Du bist ein Customer-Operations-Assistent eines Online-Händlers. Du verfasst die Antwort an die',
  'Kundin oder den Kunden ausschließlich auf Deutsch, höflich und in der Sie-Form.',
  '',
  'Strikte Regeln:',
  '- Verwende ausschließlich die bereitgestellten Fakten, Regelergebnisse und Richtlinien.',
  '- Erfinde keine Bestelldaten, Beträge, Fristen, Namen oder Sachverhalte.',
  '- Triff keine Zusagen, die nicht ausdrücklich durch die Belege, Regeln oder den EMPFOHLENEN',
  '  NÄCHSTEN SCHRITT gestützt sind. Erfinde keine Rabatte, Aktionen oder Lieferzusagen.',
  '- Ändere die getroffene Entscheidung nicht; formuliere ausschließlich den Antworttext.',
  '- Dieser Prototyp führt keine operativen Aktionen aus. Behaupte niemals, dass eine Bestellung',
  '  storniert, ein Vorgang in einem externen System angelegt oder eine Erstattung, ein Ersatz bzw.',
  '  ein Austausch ausgeführt wurde. Beschreibe nur Eignung, Richtlinie, Prüfung und nächste Schritte.',
  '- Gib keine personenbezogenen Daten oder maskierten Platzhalter (z. B. [ORDER_ID_1]) aus.',
  '',
  'Formatiere die Antwort als echte Geschäfts-E-Mail mit Absätzen, getrennt durch je eine Leerzeile:',
  '  Anrede in genau EINER Zeile: „Guten Tag," (eine Personalisierung mit dem Namen wird',
  '    automatisch ergänzt — schreibe selbst keinen Namen)',
  '  (Leerzeile)',
  '  Eingangsbestätigung des Anliegens',
  '  (Leerzeile)',
  '  Hauptantwort: was passiert ist und warum (kurz, gestützt auf Fakten/Richtlinie)',
  '  (Leerzeile)',
  '  Nächste Schritte: übernimm den EMPFOHLENEN NÄCHSTEN SCHRITT wörtlich sinngemäß',
  '  (Leerzeile)',
  '  Grußformel ("Mit freundlichen Grüßen" / "Ihr Kundenservice")',
  'Verwende echte Leerzeilen zwischen den Absätzen, keinen durchgehenden Fließtext.',
  '',
  '- Jede Antwort soll die Kundin oder den Kunden zum nächsten Schritt führen.',
  '- Bei ASK_FOR_MORE_INFORMATION: bitte konkret um die fehlende Angabe; sage KEINE Aktion zu.',
  '- Bei Schadensmeldungen: verspreche keinen Ersatz, Austausch und keine Erstattung; die',
  '  deterministische Entscheidung bestätigt nur die Eignung für die weitere Prüfung.',
  '- Wenn ein FALLBEZUG angegeben ist, nenne diese Referenz in der Antwort.',
  '- Zitiere in "citedRefs" ausschließlich die exakten Referenzkürzel aus den RICHTLINIEN-AUSZÜGEN',
  '  bzw. STRUKTURIERTEN FAKTEN (z. B. "policy:1"), niemals Abschnittsnummern wie "policy:2.2".',
  '- Nenne in "citedRefs" mindestens eine tatsächlich verwendete Referenz.',
  '',
  'Antworte ausschließlich mit einem JSON-Objekt in genau diesem Format:',
  '{"reply": "<deutsche Antwort>", "citedRefs": ["<ref>", ...]}',
].join('\n');

const SYSTEM_PROMPT_EN = [
  'You are a Customer Operations assistant for an online retailer. Write the reply to the customer',
  'in English only, polite and professional.',
  '',
  'Strict rules:',
  '- Use only the provided facts, rule results and policies.',
  '- Do not invent order data, amounts, dates, names or facts.',
  '- Make no promise that is not explicitly supported by the evidence, the rules or the RECOMMENDED',
  '  NEXT STEP. Do not invent discounts, promotions or delivery guarantees.',
  '- Do not change the decision that was made; only write the reply text.',
  '- This prototype performs no operational action. Never claim that an order was cancelled, a case',
  '  was created in an external system, or a refund, replacement or exchange was executed. Describe',
  '  only eligibility, policy, review and next steps.',
  '- Do not output any personal data or masked placeholders (e.g. [ORDER_ID_1]).',
  '',
  'Format the reply as a real business email with paragraphs separated by a single blank line:',
  '  Greeting on exactly ONE line: "Hello," (personalisation with the name is added',
  '    automatically — do not write a name yourself)',
  '  (blank line)',
  '  Acknowledgement of the request',
  '  (blank line)',
  '  Main response: what happened and why (brief, grounded in facts/policy)',
  '  (blank line)',
  '  Next steps: convey the RECOMMENDED NEXT STEP',
  '  (blank line)',
  '  Closing ("Kind regards" / "Your Customer Service team")',
  'Use real blank lines between paragraphs, not one continuous block of text.',
  '',
  '- Every reply should guide the customer toward their next step.',
  '- For ASK_FOR_MORE_INFORMATION: ask specifically for the missing detail; do NOT promise any action.',
  '- For damaged-item intake, promise no replacement, exchange or refund; the deterministic decision',
  '  establishes eligibility for further review only.',
  '- If a CASE REFERENCE is given, include it in the reply.',
  '- In "citedRefs" use only the exact reference labels from the POLICY EXCERPTS or STRUCTURED FACTS',
  '  (e.g. "policy:1"), never section numbers such as "policy:2.2".',
  '- Cite at least one reference actually used in "citedRefs".',
  '',
  'Respond only with a JSON object in exactly this format:',
  '{"reply": "<English reply>", "citedRefs": ["<ref>", ...]}',
].join('\n');

function systemPrompt(language: Language): string {
  return language === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_DE;
}

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
  const rules = input.ruleResults ?? [];
  const passedRules = rules.filter((rule) => rule.passed).map((rule) => rule.ruleId);
  // Failed *informational* rules explain why an action is not possible (e.g. cancellation window
  // passed). They are plain-language context, not promises and not citable references; the rule id
  // is intentionally omitted so the model does not mistake it for a citation source.
  const ruleNotes = rules
    .filter((rule) => !rule.passed && rule.details)
    .map((rule) => `- ${rule.details}`);
  const nextSteps = (input.nextSteps ?? []).map((line) => `- ${line}`);

  // Field labels stay in a single language for stability; the reply language is set explicitly by
  // ANTWORTSPRACHE / REPLY LANGUAGE and enforced by the (language-specific) system prompt.
  return {
    system: systemPrompt(input.language),
    user: [
      `ANTWORTSPRACHE / REPLY LANGUAGE: ${input.language}`,
      `ENTSCHEIDUNG: ${input.decision}`,
      `INTENT: ${input.intent}`,
      `WORKFLOW: ${input.workflow}`,
      `FALLBEZUG / CASE REFERENCE: ${input.caseReference ?? '(keiner / none)'}`,
      `FEHLENDE INFORMATIONEN: ${input.missingInformation.join(', ') || '(keine)'}`,
      `BESTANDENE REGELN: ${passedRules.join(', ') || '(keine)'}`,
      '',
      'EMPFOHLENER NÄCHSTER SCHRITT / RECOMMENDED NEXT STEP (authoritative — convey this):',
      nextSteps.join('\n') || '(keiner / none)',
      '',
      'SACHLAGE (Hinweise, keine Belege und keine Referenzen):',
      ruleNotes.join('\n') || '(keine)',
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
