import { z } from 'zod';
import { INTENTS } from '../domain';

/** One candidate intent with its confidence, as produced by Top-N Intent Ranking. */
export const RankedIntentSchema = z.object({
  intent: z.enum(INTENTS),
  confidence: z.number().min(0).max(1),
});

/**
 * Output contract for the Intent Classification + Top-N Intent Ranking stages.
 * This is LLM output and must always be validated against this schema.
 */
export const IntentClassificationSchema = z.object({
  /** The single most likely intent. */
  intent: z.enum(INTENTS),
  confidence: z.number().min(0).max(1),
  /** The ranked candidate intents (highest confidence first). */
  ranked: z.array(RankedIntentSchema).min(1),
});
