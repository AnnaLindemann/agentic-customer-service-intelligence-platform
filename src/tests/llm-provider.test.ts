import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  createOpenAiCompatibleClient,
  type CompletionCreate,
} from '../llm/providers/openai-compatible';
import { LlmError } from '../llm';

function response(content: string) {
  return {
    choices: [{ message: { content } }],
    model: 'test-model',
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  };
}

function sequencedClient(responses: Array<ReturnType<typeof response> | Error>) {
  let calls = 0;
  const completionCreate: CompletionCreate = async () => {
    const selected = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    if (selected instanceof Error) throw selected;
    return selected;
  };
  const client = createOpenAiCompatibleClient({
    apiKey: 'test-key',
    baseUrl: 'https://provider.invalid/v1',
    model: 'test-model',
    temperature: 0,
    maxOutputTokens: 50,
    timeoutMs: 2_000,
    providerLabel: 'test-provider',
    completionCreate,
  });
  return { client, calls: () => calls };
}

const OutputSchema = z.object({ value: z.string() });
const request = { system: 'Return JSON.', user: 'Test', schemaName: 'TestOutput' };

test('invalid JSON and schema failures are retried exactly once', async () => {
  const invalidJson = sequencedClient([
    response('not-json'),
    response(JSON.stringify({ value: 'ok' })),
  ]);
  const jsonResult = await invalidJson.client.generateJson(request, OutputSchema);
  assert.equal(jsonResult.data.value, 'ok');
  assert.equal(invalidJson.calls(), 2);

  const invalidSchema = sequencedClient([
    response(JSON.stringify({ wrong: true })),
    response(JSON.stringify({ value: 'ok' })),
  ]);
  const schemaResult = await invalidSchema.client.generateJson(request, OutputSchema);
  assert.equal(schemaResult.data.value, 'ok');
  assert.equal(invalidSchema.calls(), 2);
});

test('invalid output fails after exactly two attempts', async () => {
  const mock = sequencedClient([response('not-json')]);
  await assert.rejects(
    mock.client.generateJson(request, OutputSchema),
    (error: unknown) => error instanceof LlmError && error.kind === 'invalid_output',
  );
  assert.equal(mock.calls(), 2);
});

test('transport errors are not retried', async () => {
  const mock = sequencedClient([new Error('network unavailable')]);
  await assert.rejects(
    mock.client.generateJson(request, OutputSchema),
    (error: unknown) => error instanceof LlmError && error.kind === 'transport',
  );
  assert.equal(mock.calls(), 1);
});
