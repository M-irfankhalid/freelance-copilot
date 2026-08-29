import { ZodError } from "zod";

/**
 * Error codes for the API error envelope.
 */
export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "NO_OPENROUTER_KEY"
  | "AUTH_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "DATABASE_ERROR"
  | "PROPOSAL_ERROR"
  | "INTERNAL";

/**
 * Base error carrying an HTTP status and machine-readable code. Route
 * handlers throw these; the central error handler maps them to JSON.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    details?: unknown
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Convenience factories for the common cases. */
export const badRequest = (
  message = "Bad request",
  details?: unknown
): AppError => new AppError(400, "BAD_REQUEST", message, details);

export const validationError = (error: ZodError): AppError =>
  new AppError(
    400,
    "VALIDATION_ERROR",
    "Request data failed validation",
    error.flatten()
  );

export const notFound = (message = "Resource not found"): AppError =>
  new AppError(404, "NOT_FOUND", message);

export const unauthorized = (message = "Authentication required"): AppError =>
  new AppError(401, "UNAUTHORIZED", message);

export const internal = (message = "Internal server error"): AppError =>
  new AppError(500, "INTERNAL", message);
