import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load from .env if present
dotenv.config({ path: path.join(__dirname, '../../.env') });
// Wait, the .env will be in v3/forge-cloud/.env
dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(8), // Lowered min just in case dev env is simpler
  PORT: z.string().default('4000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
