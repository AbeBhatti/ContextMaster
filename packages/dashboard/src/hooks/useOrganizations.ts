import { api } from "../lib/api";
import { useFetch } from "./useFetch";
import type { OrganizationDetail, OrganizationSummary } from "../lib/types";

export function useOrganizations() {
  return useFetch<OrganizationSummary[]>(
    (signal) => api.organizations.list(signal),
    []
  );
}

export function useOrganization(id: string | null | undefined) {
  return useFetch<OrganizationDetail>(
    (signal) => {
      if (!id) return Promise.reject(new Error("missing organization id"));
      return api.organizations.get(id, signal);
    },
    [id]
  );
}
