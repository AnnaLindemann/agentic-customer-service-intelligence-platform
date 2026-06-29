/** Deterministic mapping from classified intent to support scope. */
import { Intent, ReasonCode } from '../../domain';

export const ScopeStatus = {
  SUPPORTED: 'SUPPORTED',
  UNKNOWN: 'UNKNOWN',
  OUT_OF_SCOPE: 'OUT_OF_SCOPE',
} as const;
export type ScopeStatus = (typeof ScopeStatus)[keyof typeof ScopeStatus];

export interface ScopeValidationResult {
  status: ScopeStatus;
  reasonCode: ReasonCode;
}

const SUPPORTED_INTENTS = new Set<Intent>([
  Intent.CANCELLATION_REQUEST,
  Intent.DAMAGED_ITEM,
  Intent.INVOICE_QUESTION,
  Intent.PRODUCT_AVAILABILITY,
]);

export function validateScope(intent: Intent): ScopeValidationResult {
  if (SUPPORTED_INTENTS.has(intent)) {
    return { status: ScopeStatus.SUPPORTED, reasonCode: ReasonCode.SUPPORTED_WORKFLOW };
  }
  if (intent === Intent.UNKNOWN) {
    return { status: ScopeStatus.UNKNOWN, reasonCode: ReasonCode.UNKNOWN_INTENT };
  }
  return { status: ScopeStatus.OUT_OF_SCOPE, reasonCode: ReasonCode.OUT_OF_SCOPE };
}
