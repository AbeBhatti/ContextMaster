import { api } from "../lib/api";
import { useFetch } from "./useFetch";
import type { WorkspaceSummary } from "../lib/types";

export function useWorkspaces() {
  return useFetch<WorkspaceSummary[]>(
    (signal) => api.workspaces.list(signal),
    []
  );
}
