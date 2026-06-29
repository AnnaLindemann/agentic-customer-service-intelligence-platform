/** Assemble validated stage outputs into the canonical CaseState. */
import { CaseStateSchema } from '../../schemas';
import type {
  CaseState,
  IntentClassification,
  SlotExtraction,
} from '../../types';
import type { PiiSanitizationResult } from './pii-sanitizer';
import type { ScopeValidationResult } from './scope-validation';
import type { WorkflowEnrichmentResult } from './workflow-enrichment';

export interface CaseStateBuilderInput {
  caseId: string;
  receivedAt: string;
  originalEmail: string;
  sanitization?: PiiSanitizationResult;
  classification?: IntentClassification;
  scope?: ScopeValidationResult;
  extraction?: SlotExtraction;
  enrichment?: WorkflowEnrichmentResult;
}

/** Build a normalized state without performing any pipeline decision or external I/O. */
export function buildCaseState(input: CaseStateBuilderInput): CaseState {
  const reasonCodes = [
    ...(input.sanitization && input.sanitization.detectedPII.length > 0
      ? ['PII_DETECTED' as const]
      : []),
    ...(input.scope ? [input.scope.reasonCode] : []),
  ];

  return CaseStateSchema.parse({
    caseId: input.caseId.trim(),
    receivedAt: input.receivedAt,
    originalEmail: input.originalEmail,
    sanitizedEmail: input.sanitization?.sanitizedEmail,
    detectedPii: input.sanitization?.detectedPII ?? [],
    maskingLog: input.sanitization?.maskingLog ?? [],
    intent: input.classification?.intent,
    rankedIntents: input.classification?.ranked ?? [],
    workflow: input.enrichment?.workflow,
    slots: input.extraction?.slots,
    missingInformation: input.enrichment?.missingInformation ?? [],
    reasonCodes,
  });
}
