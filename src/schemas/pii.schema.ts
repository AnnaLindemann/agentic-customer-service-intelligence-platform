import { z } from 'zod';

/** The categories of personal data the PII Sanitizer recognises. */
export const PII_TYPES = [
  'email',
  'phone',
  'name',
  'address',
  'order_id',
  'invoice_id',
  'customer_id',
  'other',
] as const;

/** A single piece of personal data the sanitizer found in the raw email. */
export const DetectedPIISchema = z.object({
  type: z.enum(PII_TYPES),
  /** The original text that was detected (kept out of any LLM prompt). */
  rawValue: z.string(),
  /** Placeholder substituted into the masked text, e.g. `[EMAIL_1]`. */
  maskToken: z.string(),
});

/** One masking action recorded for the audit trail (token ↔ category). */
export const MaskingLogEntrySchema = z.object({
  token: z.string(),
  piiType: z.enum(PII_TYPES),
  /** How many occurrences this token replaced. */
  occurrences: z.number().int().positive().default(1),
});
