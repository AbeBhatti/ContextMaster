import { api } from "../lib/api";
import { useFetch } from "./useFetch";
import type { ApiKey } from "../lib/types";

export function useApiKeys() {
  return useFetch<ApiKey[]>((signal) => api.auth.listApiKeys(signal), []);
}
