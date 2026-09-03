import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, NetworkError, api, get } from "./client";

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

/** Response shape for paginated job listing. */
export interface InfiniteJobsPage {
  jobs: TJobSummary[];
  total: number;
  hasMore: boolean;
}

/** Result of the useInfiniteJobs hook. */
export interface UseInfiniteJobsResult {
  jobs: TJobSummary[];
  error: ApiError | NetworkError | null;
  /** True when there is no completed response for the current request yet. */
  isLoading: boolean;
  /** True when fetching the next page of cached jobs. */
  isFetchingNext: boolean;
  /** True when scanning Freelancer.com for fresh jobs (first visit or manual scan). */
  scanning: boolean;
  hasMore: boolean;
  total: number;
  /** Ref to attach to a sentinel element at the bottom of the list. */
  sentinelRef: (node: HTMLElement | null) => void;
  /** Reset to the first page (used after a manual refresh/scan). */
  reset: () => void;
  /** Fetch fresh jobs from Freelancer.com and reload from the DB cache. */
  scan: () => Promise<void>;
}

// Lightweight alias; the real type lives in the global types module.
interface TJobSummary {
  id: string;
  projectId: number;
  title: string;
  client: string;
  clientCountry: string;
  budgetLabel: string;
  skills: string[];
  postedLabel: string;
  bidCount: number;
  avgBidLabel: string;
  matchScore?: number;
  severity?: "urgent" | "warning" | "info";
  status: "new" | "analyzed" | "ignored";
  rejectionReason?: string | null;
  bidded?: boolean;
  bidVia?: "manual" | "auto" | null;
  bidOutcome?: "in_review" | "won" | "lost" | null;
}

const PAGE_SIZE = 50;

/**
 * Fetch jobs in pages from the local DB cache endpoint. Uses an Intersection
 * Observer on a sentinel element to auto-load the next page as the user
 * scrolls near the bottom.
 *
 * On first visit — when the local cache is empty — the hook automatically
 * scans Freelancer.com for fresh jobs (via /api/jobs/search), which populates
 * the DB, then reloads page 0. All subsequent pagination reads from the cache.
 */
export function useInfiniteJobs(): UseInfiniteJobsResult {
  const [jobs, setJobs] = useState<TJobSummary[]>([]);
  const [error, setError] = useState<ApiError | NetworkError | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingNext, setIsFetchingNext] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  const autoScannedRef = useRef(false);

  const fetchPage = useCallback(
    async (pageToLoad: number, reset: boolean) => {
      if (reset) {
        setIsLoading(true);
        setError(null);
        setJobs([]);
      } else {
        setIsFetchingNext(true);
      }
      loadingRef.current = true;

      try {
        const offset = pageToLoad * PAGE_SIZE;
        const data = await api<InfiniteJobsPage>(
          `/api/jobs?limit=${PAGE_SIZE}&offset=${offset}`
        );
        if (reset) {
          setJobs(data.jobs);
        } else {
          setJobs((prev) => [...prev, ...data.jobs]);
        }
        setTotal(data.total);
        setHasMore(data.hasMore);
        setError(null);
      } catch (cause) {
        if (cause instanceof ApiError || cause instanceof NetworkError) {
          setError(cause);
        }
      } finally {
        loadingRef.current = false;
        setIsLoading(false);
        setIsFetchingNext(false);
      }
    },
    []
  );

  /** Fetch fresh jobs from Freelancer.com, persist to DB, then reload page 0. */
  const scan = useCallback(async () => {
    setScanning(true);
    try {
      await api<{ jobs: TJobSummary[] }>("/api/jobs/search");
    } catch (cause) {
      if (cause instanceof ApiError || cause instanceof NetworkError) {
        setError(cause);
      }
    } finally {
      setScanning(false);
    }
    // Reload the first page from the now-updated DB cache.
    void fetchPage(0, true);
  }, [fetchPage]);

  // Initial load + reset handling.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch triggers loading state
    void fetchPage(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Auto-scan: when the cache is empty on first load (no jobs, no error, not
  // already scanning, and we haven't auto-scanned yet), fetch fresh jobs from
  // the API so first-time visitors see something immediately.
  useEffect(() => {
    if (
      !isLoading &&
      jobs.length === 0 &&
      total === 0 &&
      !scanning &&
      !autoScannedRef.current &&
      !error
    ) {
      autoScannedRef.current = true;
      void scan();
    }
  }, [isLoading, jobs.length, total, scanning, error, scan]);

  // Intersection Observer for infinite scroll.
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || loadingRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry && entry.isIntersecting && !loadingRef.current) {
          loadingRef.current = true;
          const nextPage = Math.floor(jobs.length / PAGE_SIZE);
          fetchPage(nextPage, false).finally(() => {
            loadingRef.current = false;
          });
        }
      },
      { root: null, rootMargin: "200px", threshold: 0 }
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [sentinelRef, hasMore, fetchPage, jobs.length]);

  const reset = useCallback(() => {
    setResetKey((k) => k + 1);
    setJobs([]);
    setHasMore(true);
  }, []);

  return {
    jobs,
    error,
    isLoading,
    isFetchingNext,
    scanning,
    hasMore,
    total,
    sentinelRef: (node: HTMLElement | null) => {
      sentinelRef.current = node;
    },
    reset,
    scan,
  };
}
