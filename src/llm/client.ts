/**
 * LLM client factory — turns configuration into a provider adapter behind the `LlmClient` port.
 *
 * The whole system obtains its LLM client here. Provider selection is config-driven
 * (`LLM_PROVIDER`), so replacing Groq with OpenAI is a base-URL/key/model change, and adding
 * Anthropic is one new adapter registered in the switch below — no pipeline stage changes.
 */
import { config } from '../config/env';
import { LlmError, type LlmClient } from './types';
import { createOpenAiCompatibleClient } from './providers/openai-compatible';

export interface LlmClientOptions {
  /** Override the configured model (e.g. the dev fallback) for a specific client. */
  model?: string;
}

/** Build the configured LLM client. Throws `LlmError` for an unknown or unconfigured provider. */
export function createLlmClient(options: LlmClientOptions = {}): LlmClient {
  const llm = config.llm;
  const model = options.model ?? llm.model;

  switch (llm.provider) {
    // Groq and OpenAI share the OpenAI-compatible Chat Completions API, so one adapter serves
    // both; only the base URL and key differ (carried in config).
    case 'groq':
    case 'openai':
      return createOpenAiCompatibleClient({
        apiKey: llm.apiKey,
        baseUrl: llm.baseUrl,
        model,
        temperature: llm.temperature,
        maxOutputTokens: llm.maxOutputTokens,
        timeoutMs: llm.timeoutMs,
        providerLabel: llm.provider,
      });

    default:
      throw new LlmError(`Unsupported LLM provider: "${llm.provider}".`, 'config');
  }
}
