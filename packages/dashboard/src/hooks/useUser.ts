import { api } from "../lib/api";
import { useFetch } from "./useFetch";
import type { User } from "../lib/types";

export function useUser() {
  return useFetch<User>((signal) => api.auth.me(signal), []);
}
