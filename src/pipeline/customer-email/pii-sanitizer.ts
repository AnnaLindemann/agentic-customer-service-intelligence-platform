/** Deterministic PII masking for customer e-mail text. */
import { DetectedPIISchema, MaskingLogEntrySchema } from '../../schemas';
import type { DetectedPII, MaskingLogEntry } from '../../types';

export interface PiiSanitizationResult {
  sanitizedEmail: string;
  detectedPII: DetectedPII[];
  maskingLog: MaskingLogEntry[];
}

const RAW_EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const RAW_INVOICE_ID = /\bINV-\d{4}-\d{4}\b/iu;
const RAW_CUSTOMER_ID = /\b(?:CUST(?:OMER)?|KUND(?:E|EN))[-_][A-Z0-9]{3,}\b/iu;
const RAW_PHONE = /(?<![\w[])\+?\d(?:[\d ().-]{6,}\d)(?![\w\]])/u;
const RAW_ORDER_ID = /(?<![\w[])\d{5}(?![\w\]])/u;
const DATE_VALUE = /^\d{1,4}[.-]\d{1,2}[.-]\d{2,4}$/;

/** Fast fail-closed guard for callers of an LLM stage. */
export function containsUnmaskedPII(text: string): boolean {
  if ([RAW_EMAIL, RAW_INVOICE_ID, RAW_CUSTOMER_ID, RAW_ORDER_ID].some((pattern) => pattern.test(text))) {
    return true;
  }
  const withoutDates = text.replace(/\b\d{1,4}[.-]\d{1,2}[.-]\d{2,4}\b/g, '');
  return RAW_PHONE.test(withoutDates);
}

type PiiType = DetectedPII['type'];

interface MaskState {
  counters: Map<string, number>;
  detections: Map<string, DetectedPII>;
  occurrences: Map<string, number>;
}

function maskValue(state: MaskState, type: PiiType, label: string, rawValue: string): string {
  const raw = rawValue.trim();
  const key = `${type}\u0000${raw.toLocaleLowerCase('de-DE')}`;
  const existing = state.detections.get(key);
  if (existing) {
    state.occurrences.set(existing.maskToken, (state.occurrences.get(existing.maskToken) ?? 0) + 1);
    return existing.maskToken;
  }

  const next = (state.counters.get(label) ?? 0) + 1;
  state.counters.set(label, next);
  const maskToken = `[${label}_${next}]`;
  state.detections.set(
    key,
    DetectedPIISchema.parse({ type, rawValue: raw, maskToken }),
  );
  state.occurrences.set(maskToken, 1);
  return maskToken;
}

function replaceWhole(
  text: string,
  pattern: RegExp,
  state: MaskState,
  type: PiiType,
  label: string,
): string {
  return text.replace(pattern, (match) => maskValue(state, type, label, match));
}

function replacePhones(text: string, state: MaskState): string {
  return text.replace(new RegExp(RAW_PHONE.source, 'gu'), (match) => {
    return DATE_VALUE.test(match) ? match : maskValue(state, 'phone', 'PHONE', match);
  });
}

function replaceCaptured(
  text: string,
  pattern: RegExp,
  state: MaskState,
  type: PiiType,
  label: string,
): string {
  return text.replace(pattern, (match, prefix: string, value: string) => {
    return `${prefix}${maskValue(state, type, label, value)}`;
  });
}

/**
 * Mask identifiers and common contact details using deliberately conservative, explainable
 * regular expressions. Existing placeholders are left unchanged.
 */
export function sanitizePII(originalEmail: string): PiiSanitizationResult {
  const state: MaskState = {
    counters: new Map(),
    detections: new Map(),
    occurrences: new Map(),
  };
  let sanitizedEmail = originalEmail;

  sanitizedEmail = replaceWhole(
    sanitizedEmail,
    new RegExp(RAW_EMAIL.source, 'giu'),
    state,
    'email',
    'EMAIL',
  );
  sanitizedEmail = replaceWhole(
    sanitizedEmail,
    new RegExp(RAW_INVOICE_ID.source, 'giu'),
    state,
    'invoice_id',
    'INVOICE_ID',
  );
  sanitizedEmail = replaceWhole(
    sanitizedEmail,
    new RegExp(RAW_CUSTOMER_ID.source, 'giu'),
    state,
    'customer_id',
    'CUSTOMER_ID',
  );
  sanitizedEmail = replaceCaptured(
    sanitizedEmail,
    /\b((?:customer|kunden)[ -]?(?:id|nummer)\s*[:#-]?\s*)([A-Z0-9][A-Z0-9-]{2,})\b/giu,
    state,
    'customer_id',
    'CUSTOMER_ID',
  );
  sanitizedEmail = replaceCaptured(
    sanitizedEmail,
    /\b((?:order|bestellung|bestellnummer|auftrag)(?:\s*(?:id|number|nummer|nr\.?))?\s*[:#-]?\s*)(\d{5,})\b/giu,
    state,
    'order_id',
    'ORDER_ID',
  );
  sanitizedEmail = replacePhones(sanitizedEmail, state);
  // The MVP data contract uses five-digit order numbers. Mask bare values only after phone
  // numbers so a phone number is not split into several order identifiers.
  sanitizedEmail = replaceWhole(
    sanitizedEmail,
    new RegExp(RAW_ORDER_ID.source, 'gu'),
    state,
    'order_id',
    'ORDER_ID',
  );
  sanitizedEmail = replaceCaptured(
    sanitizedEmail,
    /\b((?:mein name ist|my name is|name\s*:|ich bin)\s+)([\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+){1,2})/giu,
    state,
    'name',
    'NAME',
  );
  sanitizedEmail = replaceCaptured(
    sanitizedEmail,
    /((?:viele grüße|mit freundlichen grüßen|best regards|regards)[, ]*\r?\n\s*)([\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+){1,2})/giu,
    state,
    'name',
    'NAME',
  );

  const detectedPII = [...state.detections.values()];
  const maskingLog = detectedPII.map((entry) =>
    MaskingLogEntrySchema.parse({
      token: entry.maskToken,
      piiType: entry.type,
      occurrences: state.occurrences.get(entry.maskToken) ?? 1,
    }),
  );

  return { sanitizedEmail, detectedPII, maskingLog };
}
