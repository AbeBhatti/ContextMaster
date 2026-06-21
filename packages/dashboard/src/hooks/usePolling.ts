import { useEffect, useRef } from "react";

interface UsePollingOptions {
  // Polling interval in ms.
  interval: number;
  // When false, the loop is paused. Use to flip between aggressive (jobs
  // in-flight) and relaxed (background freshness) cadences.
  enabled?: boolean;
  // When the tab transitions to visible we fire `fetchFn` once immediately
  // so the user sees fresh data the moment they switch back. Off by default
  // for callers that prefer no refetch on visibility change.
  refetchOnVisible?: boolean;
}

/**
 * Generic polling loop that pauses when the document is hidden and resumes
 * when it becomes visible again. Keeps the fetcher in a ref so the
 * interval doesn't tear down on every render.
 *
 * Returns nothing — the caller's fetcher is responsible for state updates.
 */
export function usePolling(
  fetchFn: () => void | Promise<void>,
  options: UsePollingOptions
): void {
  const { interval, enabled = true, refetchOnVisible = true } = options;
  const fnRef = useRef(fetchFn);
  fnRef.current = fetchFn;

  useEffect(() => {
    if (!enabled) return;
    let id: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (id !== null) return;
      id = setInterval(() => {
        if (document.visibilityState === "visible") fnRef.current();
      }, interval);
    };
    const stop = () => {
      if (id === null) return;
      clearInterval(id);
      id = null;
    };

    start();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (refetchOnVisible) fnRef.current();
        start();
      } else {
        // Pause polling while hidden — keeps the API quiet when the user
        // is on another tab.
        stop();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [interval, enabled, refetchOnVisible]);
}
