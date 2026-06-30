import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/env';
import { EvaluationDatasetSchema, buildReport, evaluateCase, renderMarkdown } from '../evaluation';
import { processEmail } from '../pipeline/process-email';

const datasetPath = path.join(process.cwd(), 'data', 'evaluation', 'system-evaluation.json');
const reportDir = path.join(process.cwd(), 'artifacts', 'evaluation');
const documentedReportPath = path.join(process.cwd(), 'docs', 'evaluation-report.md');
const CASE_DELAY_MS = 2_500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const dataset = EvaluationDatasetSchema.parse(JSON.parse(await readFile(datasetPath, 'utf8')));
  const results = [];

  for (const [index, spec] of dataset.cases.entries()) {
    console.log(`[${index + 1}/${dataset.cases.length}] ${spec.id}`);
    const startedAt = Date.now();
    const pipelineResult = await processEmail(spec.email, { demoMode: spec.demoMode });
    results.push(evaluateCase(spec, pipelineResult, Date.now() - startedAt));
    // The evaluation runner does not change provider retry behaviour. A small inter-case pause
    // simply avoids turning a quality run into an artificial API burst (calls inside one case are
    // still made by the unmodified production pipeline).
    if (index < dataset.cases.length - 1) await delay(CASE_DELAY_MS);
  }

  const report = buildReport(dataset, results, config.llm.provider, config.llm.model);
  await mkdir(reportDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(reportDir, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    writeFile(path.join(reportDir, 'latest.md'), renderMarkdown(report), 'utf8'),
    writeFile(documentedReportPath, renderMarkdown(report), 'utf8'),
  ]);

  console.log(
    `Evaluation complete: ${report.aggregate.passedCases}/${report.aggregate.totalCases} cases passed.`,
  );
  console.log(`Report: ${path.relative(process.cwd(), documentedReportPath)}`);
  if (report.aggregate.failedCases > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error('System evaluation failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
