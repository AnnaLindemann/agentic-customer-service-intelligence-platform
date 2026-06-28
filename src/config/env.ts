import dotenv from 'dotenv';
import { z } from 'zod';

// Load variables from a local .env file if present (no-op when absent).
dotenv.config({ quiet: true });

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
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
};
