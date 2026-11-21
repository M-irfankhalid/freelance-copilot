/**
 * Single API access point for the frontend. Every request flows through here
 * so errors arrive as one typed shape and components never touch fetch.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown
  ) {
    super(message);
    this.status = status;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export class NetworkError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("Cannot reach the server");
    this.cause = cause;
  }
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Typed request helper. Throws ApiError or NetworkError, never raw Responses. */
export async function api<T>(
  path: string,
  init?: Omit<RequestInit, "body"> & { body?: unknown; timeoutMs?: number }
): Promise<T> {
  const { timeoutMs = 10_000, ...rest } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "include",
      signal: controller.signal,
      ...rest,
      headers: {
        ...(rest.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...rest.headers,
      },
      body: rest.body === undefined ? undefined : JSON.stringify(rest.body),
    });
  } catch (cause) {
    // Abort raises either AbortError or TimeoutError depending on browser.
    throw new NetworkError(cause);
  } finally {
    clearTimeout(timer);
  }

  const payload = await parseJson(response);
  if (!response.ok) {
    const body = (payload ?? {}) as ApiErrorBody;
    const info = body.error ?? {};
    throw new ApiError(
      response.status,
      info.code ?? "UNKNOWN",
      info.message ?? `Request failed with status ${response.status}`,
      info.details
    );
  }

  return payload as T;
}

export function get<T>(path: string): Promise<T> {
  return api<T>(path);
}
