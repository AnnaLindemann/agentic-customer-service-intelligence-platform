/**
 * Language detection — deterministic, dependency-free (improvement set, ADR-014/ADR-001).
 *
 * Responsibility: decide whether a customer email is German or English so the reply can be written
 * in the same language. This is a *language* signal, not a business decision: it never changes the
 * decision, the retrieval or the rules (those stay language-independent). It is a small heuristic
 * over German-specific markers and orthography (umlauts / ß), run on the PII-masked email, so it
 * makes no LLM call and reads no personal data.
 *
 * Rule of thumb — German wins on any German signal. German-specific words and umlauts/ß are
 * near-unambiguous, so a single such marker classifies the text as German even when an English
 * function word is also present (e.g. an accidental leading "I" in "I möchte einen Apfel kaufen").
 * Only when no German signal exists and an English marker is present do we choose English; with no
 * signal at all we fall back to German (the house language).
 */
export type Language = 'de' | 'en';

/**
 * German-specific marker words. Each is unambiguous (it does not occur as a common English word),
 * so its presence is treated as decisive. Includes the buying/request, order, billing,
 * cancellation, damage and availability vocabulary plus common German function/greeting words.
 */
const GERMAN_MARKERS = new Set([
  // buying / request
  'möchte', 'möchten', 'mochte', 'kaufen', 'kaufe', 'bestellen', 'einen', 'eine', 'ein', 'einem',
  'einer', 'bitte', 'gerne', 'brauche', 'benötige', 'suche', 'hätte', 'hatte',
  // domain
  'bestellung', 'bestellnummer', 'rechnung', 'stornieren', 'storno', 'beschädigt', 'beschädigte',
  'lieferbar', 'verfügbar', 'vorrätig', 'lager', 'artikel', 'produkt', 'sortiment',
  // function / greeting words (none coincide with common English words)
  'der', 'die', 'das', 'und', 'ich', 'nicht', 'ist', 'sind', 'mein', 'meine', 'meinen', 'für',
  'mit', 'auf', 'haben', 'habe', 'wird', 'wurde', 'können', 'könnten', 'sie', 'ihre', 'ihren',
  'guten', 'tag', 'hallo', 'sehr', 'geehrte', 'freundlichen', 'grüßen', 'grüße', 'danke', 'noch',
  'oder', 'aber', 'wie', 'wir', 'auch', 'kann', 'wenden', 'antwort',
]);

/** Common English function/domain words used only when no German signal is present. */
const ENGLISH_MARKERS = new Set([
  'the', 'and', 'i', 'not', 'is', 'are', 'my', 'please', 'a', 'an', 'for', 'with', 'on', 'have',
  'has', 'will', 'would', 'want', 'buy', 'can', 'could', 'you', 'your', 'hello', 'hi', 'dear',
  'regards', 'thanks', 'thank', 'order', 'invoice', 'cancel', 'damaged', 'available', 'still',
  'or', 'but', 'how', 'know', 'number', 'stock', 'ship', 'apple',
]);

/**
 * Detect the language of a (masked) email. Returns German on any German-specific marker or
 * umlaut/ß; otherwise English when an English marker is present; otherwise German (house default).
 */
export function detectLanguage(text: string): Language {
  const lower = (text ?? '').toLocaleLowerCase('de-DE');

  // Strong German signals — decisive.
  if (/[äöüß]/u.test(lower)) return 'de';
  const tokens = lower.match(/[a-zà-ÿ]+/giu) ?? [];
  if (tokens.some((token) => GERMAN_MARKERS.has(token))) return 'de';

  // No German signal: English only when an English marker is present, else the house default.
  if (tokens.some((token) => ENGLISH_MARKERS.has(token))) return 'en';
  return 'de';
}
