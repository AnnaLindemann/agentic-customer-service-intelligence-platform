import { z } from 'zod';

/**
 * Structured fields extracted from the email. Every field is optional because the
 * email may not contain it; which fields are *required* is decided downstream by
 * Workflow Enrichment, not here.
 */
export const ExtractedSlotsSchema = z.object({
  orderId: z.string().optional(),
  customerEmail: z.string().optional(),
  productName: z.string().optional(),
  invoiceId: z.string().optional(),
  /** Free-text reason given by the customer (e.g. for a cancellation or damage report). */
  reason: z.string().optional(),
});

/**
 * Output contract for the Slot Extraction stage. This is LLM output and must always
 * be validated against this schema.
 */
export const SlotExtractionSchema = z.object({
  slots: ExtractedSlotsSchema,
  /** Slot names the model was asked for but could not find in the email. */
  missing: z.array(z.string()).default([]),
});
