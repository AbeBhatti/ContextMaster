import { api } from "../lib/api";
import { useFetch } from "./useFetch";
import type { DocumentRecord } from "../lib/types";

export function useDocuments(workspaceId: string | null | undefined) {
  return useFetch<DocumentRecord[]>(
    (signal) => {
      if (!workspaceId) return Promise.reject(new Error("missing workspace id"));
      return api.documents.list(workspaceId, signal);
    },
    [workspaceId]
  );
}
