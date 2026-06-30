/**
 * Out-of-Scope Subtype Detector — deterministic (ADR-001, improvement set).
 *
 * When the Decision Gate returns `OUT_OF_SCOPE` (a request understood but outside customer service),
 * the *kind* of out-of-scope request decides where the customer is pointed. This is a small,
 * deterministic keyword scan over the PII-masked email — no LLM, no PII — mirroring the
 * Escalation-Trigger Guard.
 *
 *   - `career`  → a job / careers enquiry            → redirect to the careers page;
 *   - `b2b`     → supplier / partnership / wholesale → redirect to the business-contact page;
 *   - `other`   → any other unrelated request        → no redirect; politely explain what this
 *                 mailbox actually handles.
 *
 * Note: legal / fraud / chargeback / goodwill / dispute never reach here — they are caught earlier
 * by the Escalation-Trigger Guard and routed to HUMAN_ESCALATION (see `decision-gate.ts`).
 */
export type OutOfScopeCategory = 'career' | 'b2b' | 'other';

const CAREER_PATTERNS: RegExp[] = [
  /\bbewerb\w*\b/i, // bewerben, Bewerbung
  /\bstelle(n(angebot|anzeige|ausschreibung)?)?\b/i,
  /\bkarriere\b/i,
  /\blebenslauf\b/i,
  /\bjob(s|angebot)?\b/i,
  /\bcareers?\b/i,
  /\b(job )?application\b/i,
  /\bhiring\b/i,
  /\bvacanc(y|ies)\b/i,
  /\b(open )?position\b/i,
  /\b(résumé|resume|cv)\b/i,
];

const B2B_PATTERNS: RegExp[] = [
  /\blieferant(en)?\b/i,
  /\bsupplier\b/i,
  /\bpartnerschaft\b/i,
  /\bpartnership\b/i,
  /\bkooperation\b/i,
  /\bzusammenarbeit\b/i,
  /\bgroßhandel\b/i,
  /\bwholesale\b/i,
  /\bb2b\b/i,
  /\bvendor\b/i,
  /\breseller\b/i,
  /\bdistributor(en)?\b/i,
  /\bgeschäftskund\w*\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Classify an out-of-scope request. `career` and `b2b` are checked first (they have a dedicated
 * redirect); anything else is `other`.
 */
export function detectOutOfScopeCategory(maskedEmail: string): OutOfScopeCategory {
  const text = maskedEmail ?? '';
  if (matchesAny(text, CAREER_PATTERNS)) return 'career';
  if (matchesAny(text, B2B_PATTERNS)) return 'b2b';
  return 'other';
}
