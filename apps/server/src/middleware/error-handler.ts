import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

import { createLogger } from "../lib/logger.js";
import { isAppError } from "../lib/errors.js";

const log = createLogger("system");

/**
 * Central JSON error envelope. Every failure exits through here:
 * AppError → its status and code; Zod issues → 400 with field details;
 * anything else → 500 without leaking internals.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (res.headersSent) {
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request data failed validation",
        details: err.flatten(),
      },
    });
    return;
  }

  if (isAppError(err)) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  // Body parser failures (malformed JSON) arrive as SyntaxError with a type.
  const parseFailure =
    err instanceof SyntaxError ||
    (typeof err === "object" &&
      err !== null &&
      "type" in err &&
      (err as { type?: string }).type === "entity.parse.failed");
  if (parseFailure) {
    res.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "Malformed JSON body",
      },
    });
    return;
  }

  log.error(`Unhandled error on ${req.method} ${req.originalUrl}`, {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  res.status(500).json({
    error: {
      code: "INTERNAL",
      message: "Something went wrong",
    },
  });
}
