import type { ZodType } from "zod";

import { AppError } from "./errors.js";

/**
 * Request validation helper for route handlers — parse and get typed data
 * back, or throw the standard 400 envelope.
 */
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Request body failed validation",
      result.error.flatten()
    );
  }
  return result.data;
}
