import { z } from 'zod';
import { DECISIONS, INTENTS, WORKFLOWS } from '../domain';

const ExpectedSlotsSchema = z
  .object({
    orderId: z.string().optional(),
    customerEmail: z.string().optional(),
    productName: z.string().optional(),
    invoiceId: z.string().optional(),
    reason: z.string().optional(),
  })
  .default({});

export const EvaluationCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().min(1),
  tags: z.array(z.string()).min(1),
  email: z.string().min(1),
  demoMode: z.boolean().default(true),
  expected: z.object({
    intent: z.enum(INTENTS),
    workflow: z.enum(WORKFLOWS),
    decision: z.enum(DECISIONS),
    slots: ExpectedSlotsSchema,
    missingSlots: z.array(z.string()).default([]),
    escalationCategory: z
      .enum(['dispute', 'chargeback', 'goodwill', 'fraud', 'legal'])
      .nullable()
      .default(null),
    deliveredDraft: z.boolean(),
    llmStages: z.array(z.enum(['IntentClassification', 'SlotExtraction', 'LlmDraft'])),
    forbiddenAuditValues: z.array(z.string()).default([]),
  }),
});

export const EvaluationDatasetSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  cases: z.array(EvaluationCaseSchema).min(1),
});

export type EvaluationCase = z.infer<typeof EvaluationCaseSchema>;
export type EvaluationDataset = z.infer<typeof EvaluationDatasetSchema>;
