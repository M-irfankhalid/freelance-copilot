import { useCallback, useEffect, useState } from "react";

import { ApiError, NetworkError, get } from "./client";

export interface UseApiResult<T> {
  data: T | null;
  error: ApiError | NetworkError | null;
  /** True when there is no completed response for the current request yet. */
  isLoading: boolean;
  /** Re-run the request. Previous data stays visible while reloading. */
  refetch: () => void;
}

interface RequestResult<T> {
  path: string;
  nonce: number;
  data: T | null;
  error: ApiError | NetworkError | null;
}

/**
 * Minimal data-fetching hook. Pass `null` as the path to skip the request.
 * Loading is derived from whether the current path/request has completed, so
 * the effect itself only sets state from async callbacks. While a refetch is
 * in flight the previous data remains rendered.
 */
export function useApi<T>(path: string | null): UseApiResult<T> {
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<RequestResult<T> | null>(null);

  useEffect(() => {
    if (path === null) {
      return;
    }
    let cancelled = false;
    get<T>(path)
      .then((data) => {
        if (!cancelled) {
          setResult({ path, nonce, data, error: null });
        }
      })
      .catch((cause) => {
        if (!cancelled && (cause instanceof ApiError || cause instanceof NetworkError)) {
          setResult({ path, nonce, data: null, error: cause });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path, nonce]);

  const matchesPath = result !== null && result.path === path;
  const matchesRequest = matchesPath && result.nonce === nonce;

  return {
    data: matchesPath ? result.data : null,
    error: matchesPath ? result.error : null,
    isLoading: path !== null && !matchesRequest,
    refetch: useCallback(() => setNonce((n) => n + 1), []),
  };
}
