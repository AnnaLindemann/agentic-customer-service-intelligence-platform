/**
 * Escalation-Trigger Guard — the deterministic safety net for "Human by Exception v2" (ADR-014).
 *
 * Responsibility: scan the (PII-masked) customer email for the small set of signals that company
 * policy *explicitly* reserves for a human — billing disputes, chargebacks, goodwill/Kulanz
 * requests, suspected fraud, legal threats, and disputes of a prior decision. When one is present
 * the Decision Gate must escalate regardless of workflow eligibility.
 *
 * This is what makes the rest of the v2 relaxation safe: instead of escalating on the *absence of a
 * happy path*, the system escalates on the *presence of a real exception signal*. The check is a
 * pure, deterministic keyword scan (ADR-001 — rules decide); it makes no LLM call and reads no PII
 * (the markers are generic words, not personal data), so it can safely run on the masked email.
 *
 * It is intentionally conservative: a match fails *towards* a human. The lexicon supports German
 * and English (the prototype writes German replies but accepts either language of input).
 */

/** A category of request that policy reserves for manual review. */
export type EscalationCategory =
  | 'dispute'
  | 'chargeback'
  | 'goodwill'
  | 'fraud'
  | 'legal';

export interface EscalationSignal {
  /** Whether any manual-review signal was detected. */
  triggered: boolean;
  /** The category that matched first, when triggered. */
  category?: EscalationCategory;
  /** The literal phrase that matched, for the audit trail (non-PII). */
  matched?: string;
}

/**
 * Ordered lexicon. Each entry is matched case-insensitively with word boundaries so that, e.g.,
 * "Kulanz" matches but a substring inside an unrelated word does not. Order defines precedence
 * when several categories appear; the most legally/financially sensitive come first.
 */
const TRIGGERS: ReadonlyArray<{ category: EscalationCategory; patterns: RegExp[] }> = [
  {
    category: 'legal',
    patterns: [
      /\banwalt(s|es|skanzlei)?\b/i,
      /\brechtsanwalt\b/i,
      /\brechtlich(e|er|en)?\b/i,
      /\bklage\b/i,
      /\bgericht(lich)?\b/i,
      /\blawyer\b/i,
      /\battorney\b/i,
      /\blegal action\b/i,
      /\bsue\b/i,
      /\blawsuit\b/i,
    ],
  },
  {
    category: 'fraud',
    patterns: [/\bbetrug\b/i, /\bbetrügerisch\b/i, /\bfraud(ulent)?\b/i, /\bscam\b/i],
  },
  {
    category: 'chargeback',
    patterns: [
      /\brückbuchung\b/i,
      /\bchargeback\b/i,
      /\bzahlung zurück(buchen|holen)\b/i,
      /\bkreditkarte zurück\b/i,
    ],
  },
  {
    category: 'dispute',
    patterns: [
      /\bwiderspruch\b/i,
      /\bich bestehe\b/i,
      /\bich bestehe darauf\b/i,
      /\bich akzeptiere (das|diese)\b.*\bnicht\b/i,
      /\binkasso\b/i,
      /\bbeschwerde\b/i,
      /\bdispute\b/i,
      /\bi insist\b/i,
      /\bunacceptable\b/i,
      /\bescalate\b/i,
    ],
  },
  {
    category: 'goodwill',
    patterns: [
      /\bkulanz\b/i,
      /\bkulanzregelung\b/i,
      /\bausnahme\b/i,
      /\bgoodwill\b/i,
      /\bas a gesture\b/i,
      /\bmake an exception\b/i,
    ],
  },
];

/**
 * Detect whether the masked email contains a signal that policy reserves for a human agent.
 * Returns the first matching category (by the precedence above) or `{ triggered: false }`.
 */
export function detectEscalationTriggers(maskedEmail: string): EscalationSignal {
  const text = maskedEmail ?? '';
  for (const { category, patterns } of TRIGGERS) {
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match) {
        return { triggered: true, category, matched: match[0] };
      }
    }
  }
  return { triggered: false };
}
