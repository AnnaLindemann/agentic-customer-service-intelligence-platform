/**
 * Demo clock — a fixed virtual "current date" for reproducible interview demos.
 *
 * Why this exists: one business rule is time-relative — an order may be auto-cancelled only within
 * a 24-hour window of being placed (customer-service policy §2.1, `business-rules.ts`). With the
 * real wall clock, the "eligible cancellation" demo would silently stop being eligible a day after
 * the demo data was authored. To keep the demo stable "tomorrow, next week, and during an
 * interview", demo scenarios are evaluated against this fixed virtual date instead of the real one.
 *
 * Scope and safety:
 *   - This clock is used **only** when a request is flagged as a demo scenario (the Workbench sends
 *     `demoMode: true` when the email matches a built-in scenario). Custom, free-typed emails are
 *     always evaluated against the real current time — production semantics are unchanged.
 *   - It affects only the time-relative business rule; retrieval, classification, language and PII
 *     handling are untouched.
 *   - The date is chosen to sit just after the demo data's reference date so the eligible
 *     cancellation order (placed a few hours earlier) stays inside the 24-hour window permanently.
 */

/** The frozen virtual "now" used for demo-scenario evaluation. */
export const DEMO_CLOCK_ISO = '2026-06-30T12:00:00Z';

/** A `Date` at the fixed demo clock. */
export function demoNow(): Date {
  return new Date(DEMO_CLOCK_ISO);
}
