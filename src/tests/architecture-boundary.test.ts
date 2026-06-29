import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

test('vendor OpenAI SDK imports remain inside src/llm', () => {
  const root = join(process.cwd(), 'src');
  const violations = sourceFiles(root)
    .filter((path) => !relative(root, path).startsWith(`llm${require('node:path').sep}`))
    .filter((path) => !relative(root, path).startsWith(`tests${require('node:path').sep}`))
    .filter((path) => /from\s+['"]openai['"]|require\(['"]openai['"]\)/.test(readFileSync(path, 'utf8')))
    .map((path) => relative(root, path));
  assert.deepEqual(violations, []);
});
