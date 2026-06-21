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
  // We only have the hash on the auth path; find the meta row via user set is
  // overkill, so we skip per-key last_used tracking until phase 6 wires the
  // dashboard. No-op kept for call-site parity.
  void rawKeyHash;
}
