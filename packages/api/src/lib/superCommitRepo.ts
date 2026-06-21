import type { RedisClient } from "./redis.js";
import { k } from "./keys.js";

// Redis data layer for super-commit usage accounting. Replaces the reference's
// `super_commit_usage` table + the increment_super_commit_usage RPC. A simple
// per-user-per-day counter: INCR is atomic, so concurrent commits can't race
// past the daily limit (the reference used FOR UPDATE; INCR is the Redis
// analogue). Keys expire after ~2 days so old counters self-clean.

const USAGE_TTL_SECONDS = 2 * 24 * 60 * 60;

export function today(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function getUsedToday(redis: RedisClient, userId: string): Promise<number> {
  const v = (await redis.get(k.superCommitUsage(userId, today()))) as string | null;
  return v ? Number(v) : 0;
}

// Atomically increment today's counter and return the new value.
export async function incrementUsage(redis: RedisClient, userId: string): Promise<number> {
  const key = k.superCommitUsage(userId, today());
  const next = (await redis.sendCommand(["INCR", key])) as number;
  // Refresh the TTL on every increment so an active day's key keeps living.
  await redis.sendCommand(["EXPIRE", key, String(USAGE_TTL_SECONDS)]);
  return next;
}
