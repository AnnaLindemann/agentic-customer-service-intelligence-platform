import type { EvaluationCheckCategory, EvaluatedCase } from './scoring';
import type { EvaluationDataset } from './schema';

const CATEGORIES: EvaluationCheckCategory[] = [
  'prompt',
  'intent',
  'workflow',
  'slots',
  'decision',
  'response',
  'hallucination',
  'grounding',
  'escalation',
  'pii',
];

export interface EvaluationAggregate {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  checks: Record<EvaluationCheckCategory, { passed: number; total: number; rate: number }>;
  llm: {
    calls: number;
    tokens: number;
    estimatedCostUsd: number | null;
    averageLatencyMsPerCase: number;
    p50LatencyMsPerCase: number;
    p95LatencyMsPerCase: number;
    averageEndToEndLatencyMs: number;
    p50EndToEndLatencyMs: number;
    p95EndToEndLatencyMs: number;
  };
}

export interface SystemEvaluationReport {
  dataset: { name: string; version: string; caseCount: number };
  generatedAt: string;
  provider: string;
  model: string;
  aggregate: EvaluationAggregate;
  cases: EvaluatedCase[];
}

function rate(passed: number, total: number): number {
  return total === 0 ? 1 : passed / total;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(percentileValue * sorted.length) - 1] ?? 0;
}

export function buildReport(
  dataset: EvaluationDataset,
  cases: EvaluatedCase[],
  provider: string,
  model: string,
  now = new Date(),
): SystemEvaluationReport {
  const checks = Object.fromEntries(
    CATEGORIES.map((category) => {
      const selected = cases.flatMap((item) => item.checks).filter((item) => item.category === category);
      const passed = selected.filter((item) => item.passed).length;
      return [category, { passed, total: selected.length, rate: rate(passed, selected.length) }];
    }),
  ) as EvaluationAggregate['checks'];
  const costs = cases.map((item) => item.actual.estimatedCostUsd);
  const costKnown = costs.every((value) => value !== null);
  const latencies = cases.map((item) => item.actual.latencyMs);
  const endToEndLatencies = cases.map((item) => item.actual.endToEndLatencyMs);
  const passedCases = cases.filter((item) => item.passed).length;

  return {
    dataset: { name: dataset.name, version: dataset.version, caseCount: dataset.cases.length },
    generatedAt: now.toISOString(),
    provider,
    model,
    aggregate: {
      totalCases: cases.length,
      passedCases,
      failedCases: cases.length - passedCases,
      passRate: rate(passedCases, cases.length),
      checks,
      llm: {
        calls: cases.reduce((sum, item) => sum + item.actual.llmCalls, 0),
        tokens: cases.reduce((sum, item) => sum + item.actual.tokens, 0),
        estimatedCostUsd: costKnown
          ? costs.reduce<number>((sum, value) => sum + (value ?? 0), 0)
          : null,
        averageLatencyMsPerCase:
          cases.length === 0
            ? 0
            : latencies.reduce((sum, value) => sum + value, 0) / cases.length,
        p50LatencyMsPerCase: percentile(latencies, 0.5),
        p95LatencyMsPerCase: percentile(latencies, 0.95),
        averageEndToEndLatencyMs:
          cases.length === 0
            ? 0
            : endToEndLatencies.reduce((sum, value) => sum + value, 0) / cases.length,
        p50EndToEndLatencyMs: percentile(endToEndLatencies, 0.5),
        p95EndToEndLatencyMs: percentile(endToEndLatencies, 0.95),
      },
    },
    cases,
  };
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function money(value: number | null): string {
  return value === null ? 'unknown' : `$${value.toFixed(6)}`;
}

/** Render the human-readable Phase 9 deliverable from the machine-readable report. */
export function renderMarkdown(report: SystemEvaluationReport): string {
  const { aggregate } = report;
  const lines = [
    '# Phase 9 — System Evaluation Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Dataset: ${report.dataset.name} (${report.dataset.version}, ${report.dataset.caseCount} cases)`,
    `Provider/model: ${report.provider} / ${report.model}`,
    '',
    '## Executive Summary',
    '',
    `${aggregate.passedCases}/${aggregate.totalCases} cases passed all automated checks (${percentage(aggregate.passRate)}). ` +
      'The evaluation is observational: it does not alter pipeline decisions or provider behaviour.',
    '',
    '## Quality and Safety Metrics',
    '',
    '| Area | Passed | Rate |',
    '|---|---:|---:|',
    ...CATEGORIES.map((category) => {
      const value = aggregate.checks[category];
      return `| ${category} | ${value.passed}/${value.total} | ${percentage(value.rate)} |`;
    }),
    '',
    'Hallucination detection is a deterministic safety assertion: no draft may be delivered when compliance or audit risk is high. Grounding verification requires a delivered draft to pass compliance and cite retrieved evidence. These checks detect known failure modes; they do not prove semantic truth.',
    '',
    '## Cost and Latency',
    '',
    `- LLM calls: ${aggregate.llm.calls}`,
    `- Tokens: ${aggregate.llm.tokens}`,
    `- Estimated cost: ${money(aggregate.llm.estimatedCostUsd)}`,
    `- Average summed LLM latency per case: ${aggregate.llm.averageLatencyMsPerCase.toFixed(0)} ms`,
    `- P50 / P95 summed LLM latency per case: ${aggregate.llm.p50LatencyMsPerCase.toFixed(0)} / ${aggregate.llm.p95LatencyMsPerCase.toFixed(0)} ms`,
    `- Average end-to-end pipeline latency per case: ${aggregate.llm.averageEndToEndLatencyMs.toFixed(0)} ms`,
    `- P50 / P95 end-to-end pipeline latency per case: ${aggregate.llm.p50EndToEndLatencyMs.toFixed(0)} / ${aggregate.llm.p95EndToEndLatencyMs.toFixed(0)} ms`,
    '',
    'LLM latency is summed provider-call latency. End-to-end latency is measured around the complete `processEmail` call and includes local retrieval and deterministic stages.',
    '',
    '## Case Results',
    '',
    '| Case | Result | Actual intent | Actual decision | Failed checks |',
    '|---|---|---|---|---|',
    ...report.cases.map((item) => {
      const failures = item.checks.filter((check) => !check.passed).map((check) => check.name);
      return `| ${item.id} | ${item.passed ? 'PASS' : 'FAIL'} | ${item.actual.intent} | ${item.actual.decision} | ${failures.join(', ') || '—'} |`;
    }),
    '',
    '## Failed Check Details',
    '',
    ...(report.cases.some((item) => !item.passed)
      ? report.cases.flatMap((item) => {
          if (item.passed) return [];
          const failures = item.checks.filter((check) => !check.passed);
          return [
            `### ${item.id}`,
            '',
            ...failures.map(
              (failure) =>
                `- ${failure.name}: expected ${failure.expected}; actual ${failure.actual}.`,
            ),
            ...(item.actual.failedComplianceChecks.length > 0
              ? [`- Failed compliance checks: ${item.actual.failedComplianceChecks.join(', ')}.`]
              : []),
            '',
          ];
        })
      : ['No automated checks failed.', '']),
    '## Manual Review Checklist',
    '',
    'For every failed case and a representative sample of passed cases, a reviewer should verify:',
    '',
    '**Review status: pending.** The boxes below are intentionally not auto-completed.',
    '',
    '- [ ] The intent and extracted slots preserve the meaning of the email.',
    '- [ ] The decision and reason code follow the documented Human-by-Exception matrix.',
    '- [ ] Every factual statement in the customer message is supported by cited business data or policy evidence.',
    '- [ ] The response contains no invented amount, date, status, action, promise, or case outcome.',
    '- [ ] The response asks only for information actually needed for the next deterministic step.',
    '- [ ] Explicit dispute, chargeback, goodwill, fraud, and legal signals are escalated.',
    '- [ ] The customer message contains no private data beyond data intentionally restored for that customer.',
    '- [ ] Tone, language, and next-step guidance are clear and appropriate.',
    '',
    '## Limitations',
    '',
    '- The dataset is synthetic and small; it does not represent production traffic or demographic distributions.',
    '- Exact-match intent, slot, and decision metrics depend on curated expected outputs and require reviewer maintenance.',
    '- Hallucination and grounding checks validate citations and deterministic compliance signals, not full natural-language entailment.',
    '- LLM results, cost, and latency are provider/model/run specific and can vary between runs.',
    '- The report does not measure retrieval recall against an independently labelled passage corpus.',
    '- No automated metric replaces the manual review checklist above.',
    '',
  ];
  return lines.join('\n');
}
