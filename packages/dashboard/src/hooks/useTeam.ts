import { api } from "../lib/api";
import { useFetch } from "./useFetch";
import type { TeamResponse } from "../lib/types";

export function useTeam(workspaceId: string | null | undefined) {
  return useFetch<TeamResponse>(
    (signal) => {
      if (!workspaceId) return Promise.reject(new Error("missing workspace id"));
      return api.team.get(workspaceId, signal);
    },
    [workspaceId]
  );
}
