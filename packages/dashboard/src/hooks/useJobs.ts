import { api } from "../lib/api";
import { useFetch } from "./useFetch";
import { usePolling } from "./usePolling";
import { useEventListener } from "./useEventListener";
import type {
  JobListFilters,
  JobsListResponse,
  ProcessingJobSummary,
} from "../lib/types";

const POLL_INTERVAL_INFLIGHT_MS = 5000;
const POLL_INTERVAL_IDLE_MS = 60000;

function hasInflight(jobs: ProcessingJobSummary[] | null | undefined): boolean {
  if (!jobs) return false;
  for (const j of jobs) {
    if (j.status === "queued" || j.status === "processing") return true;
  }
  return false;
}

/**
 * Fetch a paginated job list for a workspace.
 * - While any visible job is queued/processing, polls every 5s for live progress.
 * - When the queue drains, drops to a 60s freshness poll.
 * - Pauses when the tab is hidden (Page Visibility); refetches immediately on visible.
 * - Listens for 'job-completed' / 'focus' events so the list refreshes as soon
 *   as something globally changes, not on the next polling tick.
 */
export function useJobs(
  workspaceId: string | null | undefined,
  filters: JobListFilters = {}
) {
  const key = JSON.stringify(filters);
  const state = useFetch<JobsListResponse>(
    (signal) => {
      if (!workspaceId)
        return Promise.reject(new Error("missing workspace id"));
      return api.jobs.list(workspaceId, filters, signal);
    },
    [workspaceId, key]
  );

  usePolling(() => state.refetch(), {
    interval: hasInflight(state.data?.jobs)
      ? POLL_INTERVAL_INFLIGHT_MS
      : POLL_INTERVAL_IDLE_MS,
    enabled: !!workspaceId,
    refetchOnVisible: true,
  });

  useEventListener("job-completed", (e) => {
    if (!workspaceId) return;
    if (e.workspaceId && e.workspaceId !== workspaceId) return;
    state.refetch();
  });
  useEventListener("focus", () => {
    if (!workspaceId) return;
    state.refetch();
  });

  return state;
}
