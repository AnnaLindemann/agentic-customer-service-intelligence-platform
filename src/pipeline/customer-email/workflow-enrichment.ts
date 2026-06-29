/** Deterministic workflow selection and required-slot evaluation. */
import { Intent, Workflow } from '../../domain';
import type { ExtractedSlots } from '../../types';
import { ScopeStatus, type ScopeValidationResult } from './scope-validation';

export interface WorkflowEnrichmentInput {
  intent: Intent;
  scope: ScopeValidationResult;
  slots: ExtractedSlots;
}

export interface WorkflowEnrichmentResult {
  workflow: Workflow;
  requiredSlots: string[];
  missingInformation: string[];
}

const WORKFLOW_BY_INTENT: Partial<Record<Intent, Workflow>> = {
  [Intent.CANCELLATION_REQUEST]: Workflow.CANCELLATION,
  [Intent.DAMAGED_ITEM]: Workflow.DAMAGED_ITEM,
  [Intent.INVOICE_QUESTION]: Workflow.INVOICE,
  [Intent.PRODUCT_AVAILABILITY]: Workflow.PRODUCT_AVAILABILITY,
};

function isMissing(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

export function enrichWorkflow(input: WorkflowEnrichmentInput): WorkflowEnrichmentResult {
  if (input.scope.status !== ScopeStatus.SUPPORTED) {
    return { workflow: Workflow.UNSUPPORTED, requiredSlots: [], missingInformation: [] };
  }

  const workflow = WORKFLOW_BY_INTENT[input.intent] ?? Workflow.UNSUPPORTED;
  switch (workflow) {
    case Workflow.CANCELLATION: {
      const requiredSlots = ['orderId'];
      return {
        workflow,
        requiredSlots,
        missingInformation: isMissing(input.slots.orderId) ? requiredSlots : [],
      };
    }
    case Workflow.DAMAGED_ITEM: {
      const requiredSlots = ['orderId', 'reason'];
      return {
        workflow,
        requiredSlots,
        missingInformation: requiredSlots.filter((key) =>
          isMissing(input.slots[key as 'orderId' | 'reason']),
        ),
      };
    }
    case Workflow.INVOICE: {
      const requiredSlots = ['invoiceId|orderId'];
      const missingInformation =
        isMissing(input.slots.invoiceId) && isMissing(input.slots.orderId) ? requiredSlots : [];
      return { workflow, requiredSlots, missingInformation };
    }
    case Workflow.PRODUCT_AVAILABILITY: {
      const requiredSlots = ['productName'];
      return {
        workflow,
        requiredSlots,
        missingInformation: isMissing(input.slots.productName) ? requiredSlots : [],
      };
    }
    default:
      return { workflow: Workflow.UNSUPPORTED, requiredSlots: [], missingInformation: [] };
  }
}
