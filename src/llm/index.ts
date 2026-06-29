/**
 * LLM layer barrel — the provider-neutral interface the pipeline depends on.
 *
 *   import { createLlmClient, type LlmClient } from '../../llm';
 *
 * Only the port (`LlmClient`), the factory and the error type are public. Provider adapters
 * are internal: nothing outside this layer should import a vendor SDK.
 */
export { createLlmClient, type LlmClientOptions } from './client';
export {
  LlmError,
  type LlmClient,
  type LlmJsonRequest,
  type LlmJsonResult,
  type LlmUsage,
  type LlmCallMeta,
  type JsonValidationResult,
} from './types';
