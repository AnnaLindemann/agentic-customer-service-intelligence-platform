import dotenv from 'dotenv';
import { z } from 'zod';

// Load variables from a local .env file if present (no-op when absent).
dotenv.config({ quiet: true });

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // --- LLM layer (Phase 6) ---
  // Provider-neutral selection. The pipeline never reads these directly; only the LLM
  // layer (`src/llm`) does. Swapping provider = changing LLM_PROVIDER + base URL + key.
  LLM_PROVIDER: z.string().default('groq'),
  // Default model for the prototype: GPT-OSS-120B served via Groq's OpenAI-compatible API.
  LLM_MODEL: z.string().default('openai/gpt-oss-120b'),
  // Dev fallback model (cheaper/faster). Set LLM_MODEL to this in development.
  LLM_FALLBACK_MODEL: z.string().default('openai/gpt-oss-20b'),
  // Groq is accessed through the OpenAI SDK with this base URL.
  GROQ_BASE_URL: z.string().default('https://api.groq.com/openai/v1'),
  // Optional at config-parse time so `build`/non-LLM paths work without a key; the provider
  // factory throws a clear error if it is missing when an LLM call is actually attempted.
  GROQ_API_KEY: z.string().optional(),
  // Low temperature: customer-facing drafts should be steady and grounded, not creative.
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(800),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.message);
  process.exit(1);
}

export const config = {
  nodeEnv: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  llm: {
    provider: parsed.data.LLM_PROVIDER,
    model: parsed.data.LLM_MODEL,
    fallbackModel: parsed.data.LLM_FALLBACK_MODEL,
    baseUrl: parsed.data.GROQ_BASE_URL,
    apiKey: parsed.data.GROQ_API_KEY,
    temperature: parsed.data.LLM_TEMPERATURE,
    maxOutputTokens: parsed.data.LLM_MAX_OUTPUT_TOKENS,
    timeoutMs: parsed.data.LLM_TIMEOUT_MS,
  },
};
