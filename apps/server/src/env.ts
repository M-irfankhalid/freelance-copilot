import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { z } from "zod";

/**
 * Environment configuration. Loads apps/server/.env first, then the repo-root
 * .env as fallback (values already set are never overwritten). The process
 * refuses to start on invalid or missing values — fail loudly, never guess.
 */

const here = dirname(fileURLToPath(import.meta.url));
// Local app env wins; root env fills anything missing.
dotenv.config({ path: resolve(here, "../.env") });
dotenv.config({ path: resolve(here, "../../../.env") });

const envSchema = z.object({
  /** Named SERVER_PORT so hosting tools that inject a generic PORT cannot
   * accidentally drag the API onto the frontend's port. */
  SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  /** SQLite file location. ":memory:" keeps everything in RAM (used by tests). */
  DATABASE_PATH: z.string().default("./data/app.db"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Frontend origin allowed to call the API. */
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  /**
   * Master secret for encrypting stored platform credentials at rest.
   * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   */
  ENCRYPTION_KEY: z
    .string()
    .min(32, "ENCRYPTION_KEY must be at least 32 characters"),
});

export const env = envSchema.parse(process.env);

export type Env = z.infer<typeof envSchema>;
