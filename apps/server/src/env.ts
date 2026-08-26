import "dotenv/config";

import { z } from "zod";

/**
 * Environment configuration. The process refuses to start on invalid or
 * missing values — fail loudly, never guess.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  /** SQLite file location. ":memory:" keeps everything in RAM (used by tests). */
  DATABASE_PATH: z.string().default("./data/app.db"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Frontend origin allowed to call the API. */
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
});

export const env = envSchema.parse(process.env);

export type Env = z.infer<typeof envSchema>;
