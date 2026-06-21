import { AUTH_BYPASS_ENABLED } from "./constants";

type TokenGetter = () => Promise<string | null>;

let currentTokenGetter: TokenGetter = async () => null;

export function setTokenGetter(getter: TokenGetter): void {
  currentTokenGetter = getter;
}

export async function getAuthToken(): Promise<string | null> {
  if (AUTH_BYPASS_ENABLED) return null;
  return currentTokenGetter();
}
