import { useCallback, useEffect, useRef, useState } from "react";

export interface FetchState<T> {
  data: T | null;
  // True only when there is no data yet (initial mount or post-error).
  // Refetches do NOT flip this back to true — that would flash the skeleton
  // every time auto-refresh kicks in. See `revalidating` for in-flight
  // refetches.
  loading: boolean;
  // True whenever a network request is in flight, including refetches with
  // existing data. Use this to render a subtle "syncing…" affordance, or
  // ignore it if the freshness pop-in is fine.
  revalidating: boolean;
  error: string | null;
  refetch: () => void;
  setData: (data: T | null) => void;
}

export interface UseFetchOptions {
  // When false, the legacy behavior is restored: refetch flips `loading`
  // back to true and clears any visible data. Callers that opt out must
  // handle the skeleton flash themselves. Default is true (stale-while-
  // revalidate) because every consumer in this dashboard prefers no flicker.
  keepPreviousData?: boolean;
}

export function useFetch<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: ReadonlyArray<unknown>,
  options: UseFetchOptions = {}
): FetchState<T> {
  const { keepPreviousData = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [revalidating, setRevalidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // We need to read "do we already have data?" inside the effect without
  // adding `data` as a dep (that would re-fire on every successful fetch).
  const hasDataRef = useRef(false);
  hasDataRef.current = data !== null;

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    // First fetch (or recovering from error): show the skeleton. Otherwise
    // keep existing data visible and surface the in-flight state via
    // `revalidating`.
    if (!keepPreviousData || !hasDataRef.current) {
      setLoading(true);
    } else {
      setRevalidating(true);
    }
    setError(null);
    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (!alive) return;
        setData(result);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
        setRevalidating(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version, keepPreviousData]);

  const refetch = useCallback(() => setVersion((v) => v + 1), []);

  return { data, loading, revalidating, error, refetch, setData };
}
