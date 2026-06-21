import { api } from "../lib/api";
import { useFetch } from "./useFetch";
import { useEventListener } from "./useEventListener";
import type { WorkspaceDetail } from "../lib/types";

export function useWorkspace(id: string | null | undefined) {
  const state = useFetch<WorkspaceDetail>(
    (signal) => {
      if (!id) return Promise.reject(new Error("missing workspace id"));
      return api.workspaces.get(id, signal);
    },
    [id]
  );

  // KB stats (chunk counts, last_updated) live inside WorkspaceDetail —
  // refetch whenever a job completes or any signal indicates a chunk-level
  // change. Also wakes on window focus via the global 'focus' event.
  useEventListener("kb-updated", (e) => {
    if (!id) return;
    if (e.workspaceId && e.workspaceId !== id) return;
    state.refetch();
  });
  useEventListener("session-created", (e) => {
    if (!id) return;
    if (e.workspaceId && e.workspaceId !== id) return;
    state.refetch();
  });
  useEventListener("focus", () => {
    if (!id) return;
    state.refetch();
  });

  return state;
}
