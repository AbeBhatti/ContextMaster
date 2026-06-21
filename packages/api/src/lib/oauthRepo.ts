import type { RedisClient } from "./redis.js";
import { k } from "./keys.js";

// Redis data layer for OAuth. Replaces the reference's oauth_clients and
// oauth_authorization_codes Postgres tables:
//   oauth_clients              -> Hash  cm:oauth:client:{clientId}
//   oauth_authorization_codes  -> Hash  cm:oauth:code:{code}  (10-min TTL)
// Auth codes are single-use and short-lived, so we lean on Redis EXPIRE for
// cleanup and a used_at stamp for replay protection.

export interface OAuthClient {
  client_id: string;
  client_secret_hash: string;
  name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
}

export interface OAuthAuthCode {
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scope: string;
  code_challenge: string | null;
  code_challenge_method: string;
  expires_at: number; // epoch ms
  used_at: number | null; // epoch ms
}

// ---- clients -------------------------------------------------------

export async function createClient(
  redis: RedisClient,
  client: OAuthClient
): Promise<void> {
  await redis.sendCommand([
    "HSET",
    k.oauthClient(client.client_id),
    "client_id", client.client_id,
    "client_secret_hash", client.client_secret_hash,
    "name", client.name,
    "redirect_uris", JSON.stringify(client.redirect_uris),
    "token_endpoint_auth_method", client.token_endpoint_auth_method,
  ]);
}

export async function getClient(
  redis: RedisClient,
  clientId: string
): Promise<OAuthClient | null> {
  const h = (await redis.hGetAll(k.oauthClient(clientId))) as Record<
    string,
    string
  >;
  if (!h || Object.keys(h).length === 0) return null;
  let redirectUris: string[] = [];
  try {
    redirectUris = JSON.parse(h.redirect_uris ?? "[]");
  } catch {
    redirectUris = [];
  }
  return {
    client_id: h.client_id ?? clientId,
    client_secret_hash: h.client_secret_hash ?? "",
    name: h.name ?? "Unknown client",
    redirect_uris: redirectUris,
    token_endpoint_auth_method:
      h.token_endpoint_auth_method ?? "client_secret_post",
  };
}

// ---- authorization codes -------------------------------------------

export async function createAuthCode(
  redis: RedisClient,
  row: Omit<OAuthAuthCode, "used_at">
): Promise<void> {
  const key = k.oauthCode(row.code);
  await redis.sendCommand([
    "HSET",
    key,
    "code", row.code,
    "client_id", row.client_id,
    "user_id", row.user_id,
    "redirect_uri", row.redirect_uri,
    "scope", row.scope,
    "code_challenge", row.code_challenge ?? "",
    "code_challenge_method", row.code_challenge_method,
    "expires_at", String(row.expires_at),
  ]);
  // Self-expire shortly after the 10-min validity window so used/stale codes
  // don't accumulate. PX matches the reference's expires_at semantics.
  const ttlMs = Math.max(1000, row.expires_at - Date.now() + 60_000);
  await redis.sendCommand(["PEXPIRE", key, String(Math.round(ttlMs))]);
}

export async function getAuthCode(
  redis: RedisClient,
  code: string
): Promise<OAuthAuthCode | null> {
  const h = (await redis.hGetAll(k.oauthCode(code))) as Record<string, string>;
  if (!h || Object.keys(h).length === 0) return null;
  return {
    code: h.code ?? code,
    client_id: h.client_id ?? "",
    user_id: h.user_id ?? "",
    redirect_uri: h.redirect_uri ?? "",
    scope: h.scope ?? "mcp",
    code_challenge: h.code_challenge ? h.code_challenge : null,
    code_challenge_method: h.code_challenge_method || "S256",
    expires_at: Number(h.expires_at ?? 0),
    used_at: h.used_at ? Number(h.used_at) : null,
  };
}

export async function markAuthCodeUsed(
  redis: RedisClient,
  code: string
): Promise<void> {
  await redis.sendCommand([
    "HSET",
    k.oauthCode(code),
    "used_at",
    String(Date.now()),
  ]);
}
