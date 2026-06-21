import { api } from "../lib/api";
import { useFetch } from "./useFetch";
import type { KnowledgeBase } from "../lib/types";

export function useKnowledgeBases(workspaceId: string | null | undefined) {
  return useFetch<KnowledgeBase[]>(
    (signal) => {
      if (!workspaceId) return Promise.reject(new Error("missing workspace id"));
      return api.knowledgeBases.list(workspaceId, signal);
    },
    [workspaceId]
  );
}
