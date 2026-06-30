/** Deterministic safety and grounding checks over a generated customer response. */
import { Decision, ReasonCode } from '../../domain';
import type {
  BusinessRuleResult,
  ComplianceCheck,
  ComplianceResult,
  RetrievedSource,
  StructuredSource,
} from '../../types';
import { detectLanguage, type Language } from './language';

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

/**
 * Markers that make a clause *not* an affirmative promise (ADR-014). A commitment term inside a
 * negated / impossibility clause ("eine Stornierung ist nicht mehr möglich") or a request / review
 * clause ("damit wir Ihre Stornierung prüfen", "bitte senden Sie …") is naming the topic, not
 * promising the outcome, and must not be treated as an unsupported promise. The patterns are
 * deliberately conservative: anything affirmative still counts as a commitment.
 */
const NEGATION_MARKERS =
  /\b(nicht|kein|keine|keinen|leider nicht|nicht mehr|nicht möglich|ausgeschlossen|cannot|can't|not possible|no longer)\b/i;
const REQUEST_MARKERS =
  /\b(bitte|senden sie|teilen sie|nennen sie|benötig|damit wir|sobald|prüf|review|provide|confirm|bestätigen sie)\b/i;

/** Split a draft into sentence-like clauses for context-aware commitment detection. */
function clauses(text: string): string[] {
  return text
    .split(/[.!?\n]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Does the draft *affirmatively* commit to the category's action? True only when a clause contains
 * the category term and is neither negated/impossibility nor a request/review clause. This is what
 * distinguishes "we will refund you" (a promise) from "a refund is not possible" / "send your
 * order number so we can review the cancellation" (not promises).
 */
function affirmsCommitment(draft: string, category: CommitmentCategory): boolean {
  return clauses(draft).some(
    (clause) =>
      category.draft.test(clause) &&
      !NEGATION_MARKERS.test(clause) &&
      !REQUEST_MARKERS.test(clause),
  );
}

export interface ComplianceInput {
  decision: Decision;
  draft: string;
  citedRefs: string[];
  structuredFacts: StructuredSource[];
  policyEvidence: RetrievedSource[];
  ruleResults?: BusinessRuleResult[];
  piiValues: string[];
  /** Expected customer language; the draft is checked to be written in it. Defaults to German. */
  language?: Language;
}

function check(name: string, passed: boolean, detail?: string): ComplianceCheck {
  return { name, passed, detail };
}

/** Conservative German check: uncertain or very short text fails closed. */
export function isLikelyGerman(text: string): boolean {
  const tokens = text.toLocaleLowerCase('de-DE').match(/[\p{L}]+/gu) ?? [];
  if (tokens.length < 4) return false;
  const markers = tokens.filter((token) => GERMAN_MARKERS.has(token)).length;
  return markers >= 2 || (markers >= 1 && /[äöüß]/iu.test(text));
}

/**
 * Does the draft match the expected customer language? German uses the conservative German check;
 * English requires the deterministic detector to read the draft as English (and no German
 * orthography). Short text fails closed.
 */
function languageMatches(text: string, language: Language): boolean {
  const tokens = text.match(/[\p{L}]+/gu) ?? [];
  if (tokens.length < 4) return false;
  return language === 'de' ? isLikelyGerman(text) : detectLanguage(text) === 'en';
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
  // Only *affirmative* commitments are promises; naming the topic in a negated/impossibility or
  // request/review clause is not (ADR-014). An affirmative commitment must be an AUTO_REPLY backed
  // by a valid citation whose cited support actually mentions the action.
  //
  // For an ASK_FOR_MORE_INFORMATION reply nothing is delivered yet (the `matches_decision` check
  // already requires it to be a request), so acknowledging the customer's *own* requested
  // non-financial action — cancellation — is not a system promise of value. The financial
  // categories (refund, compensation, guarantee, free-of-charge) are always checked, including for
  // ASK, because those are the genuinely risky unsupported promises.
  const checkedCategories =
    input.decision === Decision.ASK_FOR_MORE_INFORMATION
      ? COMMITMENT_CATEGORIES.filter((category) => category.name !== 'cancellation')
      : COMMITMENT_CATEGORIES;
  const commitments = checkedCategories.filter((category) => affirmsCommitment(draft, category));
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

  const language: Language = input.language ?? 'de';
  const languageOk = languageMatches(draft, language);
  checks.push(
    check(
      'language_match',
      languageOk,
      languageOk ? undefined : `Draft is not confidently identifiable as ${language}.`,
    ),
  );

  let matchesDecision = false;
  if (input.decision === Decision.AUTO_REPLY) {
    matchesDecision = draft.trim().length > 0;
  } else if (input.decision === Decision.ASK_FOR_MORE_INFORMATION) {
    matchesDecision =
      draft.trim().length > 0 &&
      (draft.includes('?') ||
        /\b(bitte|benötig|senden sie|teilen sie|please|send|provide|share|could you|let us know)\b/i.test(
          draft,
        ));
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
