/** Deterministic safety and grounding checks over a generated customer response. */
import { Decision, ReasonCode } from '../../domain';
import type {
  BusinessRuleResult,
  ComplianceCheck,
  ComplianceResult,
  RetrievedSource,
  StructuredSource,
} from '../../types';

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_PATTERN = /(?:\+\d{7,}|\+?\d[\d\s()-]{8,}\d)/;

const GERMAN_MARKERS = new Set([
  'aber', 'auch', 'auf', 'bitte', 'danke', 'dass', 'der', 'die', 'ein', 'eine', 'für', 'guten',
  'haben', 'ihnen', 'ihre', 'können', 'mit', 'noch', 'oder', 'sie', 'uns', 'und', 'wir', 'wird',
  'zur', 'zum',
]);

interface CommitmentCategory {
  name: string;
  draft: RegExp;
  support: RegExp;
}

const COMMITMENT_CATEGORIES: CommitmentCategory[] = [
  { name: 'refund', draft: /erstatt|rückerstatt|refund/i, support: /erstatt|rückerstatt|refund/i },
  { name: 'cancellation', draft: /storn|cancel/i, support: /storn|cancel/i },
  { name: 'compensation', draft: /entschäd|gutschrift|compensation|credit/i, support: /entschäd|gutschrift|compensation|credit/i },
  { name: 'guarantee', draft: /garanti|guarantee/i, support: /garanti|guarantee/i },
  { name: 'free-of-charge', draft: /kostenlos|kostenfrei|free of charge/i, support: /kostenlos|kostenfrei|free of charge/i },
];

export interface ComplianceInput {
  decision: Decision;
  draft: string;
  citedRefs: string[];
  structuredFacts: StructuredSource[];
  policyEvidence: RetrievedSource[];
  ruleResults?: BusinessRuleResult[];
  piiValues: string[];
}

function check(name: string, passed: boolean, detail?: string): ComplianceCheck {
  return { name, passed, detail };
}

/** Conservative language check: uncertain or very short text fails closed. */
export function isLikelyGerman(text: string): boolean {
  const tokens = text.toLocaleLowerCase('de-DE').match(/[\p{L}]+/gu) ?? [];
  if (tokens.length < 4) return false;
  const markers = tokens.filter((token) => GERMAN_MARKERS.has(token)).length;
  return markers >= 2 || (markers >= 1 && /[äöüß]/iu.test(text));
}

function citedSupportText(input: ComplianceInput): string {
  const cited = new Set(input.citedRefs);
  const policy = input.policyEvidence
    .filter((passage) => cited.has(passage.ref))
    .map((passage) => passage.snippet);
  const passedRules = (input.ruleResults ?? [])
    .filter((rule) => rule.passed)
    .map((rule) => rule.ruleId);
  return [...policy, ...passedRules].join('\n');
}

export function validateCompliance(input: ComplianceInput): ComplianceResult {
  const draft = input.draft ?? '';
  const lowerDraft = draft.toLocaleLowerCase('de-DE');
  const checks: ComplianceCheck[] = [];

  const availableRefs = new Set([
    ...input.structuredFacts.map((fact) => fact.ref),
    ...input.policyEvidence.map((passage) => passage.ref),
  ]);
  const unknownRefs = input.citedRefs.filter((ref) => !availableRefs.has(ref));
  const citationsValid = input.citedRefs.length > 0 && unknownRefs.length === 0;
  checks.push(
    check(
      'grounded_citations',
      citationsValid,
      input.citedRefs.length === 0
        ? 'At least one evidence reference is required.'
        : unknownRefs.length > 0
          ? `Unknown references cited: ${unknownRefs.join(', ')}.`
          : undefined,
    ),
  );

  const supportText = citedSupportText(input);
  const commitments = COMMITMENT_CATEGORIES.filter((category) => category.draft.test(draft));
  const unsupported = commitments.filter(
    (category) =>
      input.decision !== Decision.AUTO_REPLY ||
      !citationsValid ||
      !category.support.test(supportText),
  );
  checks.push(
    check(
      'no_unsupported_promises',
      unsupported.length === 0,
      unsupported.length > 0
        ? `Unsupported commitment categories: ${unsupported.map((item) => item.name).join(', ')}.`
        : undefined,
    ),
  );

  const leakedValue = input.piiValues.find(
    (value) => value.trim().length >= 3 && lowerDraft.includes(value.toLocaleLowerCase('de-DE')),
  );
  const withoutDates = draft.replace(/\b\d{1,4}[.-]\d{1,2}[.-]\d{2,4}\b/g, '');
  const patternLeak = EMAIL_PATTERN.test(draft) || PHONE_PATTERN.test(withoutDates);
  checks.push(
    check(
      'no_pii_leakage',
      leakedValue === undefined && !patternLeak,
      leakedValue !== undefined
        ? 'Draft reproduced a known PII value.'
        : patternLeak
          ? 'Draft contains an e-mail/phone pattern.'
          : undefined,
    ),
  );

  checks.push(
    check(
      'german_language',
      isLikelyGerman(draft),
      isLikelyGerman(draft) ? undefined : 'Draft is not confidently identifiable as German.',
    ),
  );

  let matchesDecision = false;
  if (input.decision === Decision.AUTO_REPLY) {
    matchesDecision = draft.trim().length > 0;
  } else if (input.decision === Decision.ASK_FOR_MORE_INFORMATION) {
    matchesDecision =
      draft.trim().length > 0 &&
      (draft.includes('?') || /\b(bitte|benötig|senden sie|teilen sie)/i.test(draft));
  }
  checks.push(
    check(
      'matches_decision',
      matchesDecision,
      matchesDecision ? undefined : `Draft does not match decision ${input.decision}.`,
    ),
  );

  const passed = checks.every((item) => item.passed);
  return {
    passed,
    reasonCode: passed ? undefined : ReasonCode.ESCALATION_REQUIRED,
    checks,
  };
}
