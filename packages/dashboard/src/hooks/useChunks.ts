import { api } from "../lib/api";
import { useFetch } from "./useFetch";
import type { ChunkFilters, PaginatedChunks } from "../lib/types";

export function useChunks(
  workspaceId: string | null | undefined,
  kbId: string | null | undefined,
  filters: ChunkFilters = {}
) {
  const filterKey = JSON.stringify(filters);
  return useFetch<PaginatedChunks>(
    (signal) => {
      if (!workspaceId || !kbId)
        return Promise.reject(new Error("missing ids"));
      return api.knowledgeBases.getChunks(workspaceId, kbId, filters, signal);
    },
    [workspaceId, kbId, filterKey]
  );
}
