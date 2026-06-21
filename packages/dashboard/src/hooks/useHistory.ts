import { api } from "../lib/api";
import { useFetch } from "./useFetch";
import { useEventListener } from "./useEventListener";
import type { HistoryFilters, SessionEntry } from "../lib/types";

export function useHistory(
  workspaceId: string | null | undefined,
  filters: HistoryFilters = {}
) {
  const key = JSON.stringify(filters);
  const state = useFetch<SessionEntry[]>(
    (signal) => {
      if (!workspaceId) return Promise.reject(new Error("missing workspace id"));
      return api.history.get(workspaceId, filters, signal);
    },
    [workspaceId, key]
  );

  // A new session ID surfaces in the timeline as soon as commit completes —
  // refetch on every signal that means new history.
  useEventListener("session-created", (e) => {
    if (!workspaceId) return;
    if (e.workspaceId && e.workspaceId !== workspaceId) return;
    state.refetch();
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
