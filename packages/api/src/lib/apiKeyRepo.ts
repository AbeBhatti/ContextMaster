import { randomUUID, createHash, randomBytes } from "node:crypto";
import type { RedisClient } from "./redis.js";
import { k } from "./keys.js";
import type { ApiKey } from "./types.js";

// Redis data layer for API keys. The hot path is auth: hash the presented key
// and read apikey:hash:{hash} -> userId in O(1) (replaces the reference's
// api_keys table lookup). Metadata lives in a per-key hash for the dashboard.

export function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function msToIso(ms: string | null | undefined): string | null {
  if (!ms) return null;
  const n = Number(ms);
  return Number.isNaN(n) ? null : new Date(n).toISOString();
}

export async function lookupUserIdByKey(redis: RedisClient, rawKey: string): Promise<string | null> {
  const userId = (await redis.get(k.apiKeyByHash(hashKey(rawKey)))) as string | null;
  return userId ?? null;
}

export interface CreateApiKeyResult {
  apiKey: ApiKey;
  rawKey: string; // shown to the caller exactly once
}

// Generates a new key, stores its hash->userId mapping plus metadata, and
// returns the plaintext key once. Prefix `cm_` mirrors the reference's `cntxt_`.
export async function createApiKey(
  redis: RedisClient,
  userId: string,
  name?: string,
  presetRawKey?: string
): Promise<CreateApiKeyResult> {
  const rawKey = presetRawKey ?? `cm_${randomBytes(24).toString("hex")}`;
  const keyHash = hashKey(rawKey);
  const id = randomUUID();
  const now = Date.now();
  const keyPrefix = rawKey.slice(0, 8);

  const fields: string[] = [
    "user_id", userId,
    "key_hash", keyHash,
    "key_prefix", keyPrefix,
    "created_at", String(now),
  ];
  if (name) fields.push("name", name);

  await redis.sendCommand(["HSET", k.apiKeyMeta(id), ...fields]);
  await redis.set(k.apiKeyByHash(keyHash), userId);
  await redis.sAdd(k.userApiKeys(userId), id);

  return {
    rawKey,
    apiKey: {
      id,
      user_id: userId,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      name: name ?? null,
      last_used_at: null,
      created_at: msToIso(String(now))!,
      revoked_at: null,
    },
  };
}

export async function touchLastUsed(redis: RedisClient, rawKeyHash: string): Promise<void> {
  // We only have the hash on the auth path; finding the meta row via the user
  // set is overkill, so we skip per-key last_used tracking. No-op kept for
  // call-site parity with the reference.
  void rawKeyHash;
}

function hashToApiKey(id: string, h: Record<string, string>): ApiKey {
  return {
    id,
    user_id: h.user_id ?? "",
    key_hash: h.key_hash ?? "",
    key_prefix: h.key_prefix ?? "",
    name: h.name ?? null,
    last_used_at: msToIso(h.last_used_at),
    created_at: msToIso(h.created_at) ?? new Date().toISOString(),
    revoked_at: msToIso(h.revoked_at),
  };
}

// List a user's API keys, newest first. Mirrors the reference's
// GET /api/auth/api-keys (id, key_prefix, name, last_used_at, created_at,
// revoked_at — never the hash or raw key).
export async function listApiKeys(redis: RedisClient, userId: string): Promise<ApiKey[]> {
  const ids = (await redis.sMembers(k.userApiKeys(userId))) as string[];
  const out: ApiKey[] = [];
  for (const id of ids) {
    const h = (await redis.hGetAll(k.apiKeyMeta(id))) as Record<string, string>;
    if (h && Object.keys(h).length > 0) out.push(hashToApiKey(id, h));
  }
  out.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return out;
}

// Soft-revoke a key: stamp revoked_at on the meta hash and drop the O(1) auth
// mapping so the key stops authenticating immediately. Scoped to the owning
// user so one user can't revoke another's key.
export async function revokeApiKey(
  redis: RedisClient,
  userId: string,
  id: string
): Promise<boolean> {
  const h = (await redis.hGetAll(k.apiKeyMeta(id))) as Record<string, string>;
  if (!h || Object.keys(h).length === 0) return false;
  if (h.user_id !== userId) return false;
  await redis.sendCommand(["HSET", k.apiKeyMeta(id), "revoked_at", String(Date.now())]);
  if (h.key_hash) await redis.del(k.apiKeyByHash(h.key_hash));
  return true;
}
