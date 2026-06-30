/**
 * Decision Engine barrel — the Phase 5 decision stages plus their composed entry point.
 *
 * The pipeline depends on `runDecisionEngine` (the combined stage); the individual stages are
 * exported for direct use, tests and inspection.
 *
 *   import { runDecisionEngine } from './pipeline/decision';
 */

// Decision Engine — the combined stage entry point.
export { runDecisionEngine, type DecisionEngineInput } from './decision-engine';

// Data Sufficiency Evaluation.
export { evaluateDataSufficiency, type SufficiencyInput } from './data-sufficiency';

// Business Rule Engine.
export {
  applyBusinessRules,
  CANCELLATION_WINDOW_HOURS,
  DAMAGED_ITEM_WINDOW_DAYS,
  type BusinessRuleInput,
} from './business-rules';

// Decision Gate.
export {
  decide,
  MIN_INTENT_CONFIDENCE,
  MIN_INTENT_MARGIN,
  type DecisionGateInput,
} from './decision-gate';

// Escalation-Trigger Guard (ADR-014) — deterministic detector for human-only signals.
export {
  detectEscalationTriggers,
  type EscalationSignal,
  type EscalationCategory,
} from './escalation-triggers';

// Case Intake — deterministic simulated case references for action/intake outcomes.
export { buildCaseReference } from './case-intake';

// Out-of-Scope subtype detection — chooses the right redirect for an out-of-scope request.
export { detectOutOfScopeCategory, type OutOfScopeCategory } from './out-of-scope';
