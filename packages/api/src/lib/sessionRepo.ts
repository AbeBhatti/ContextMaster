import { randomUUID } from "node:crypto";
import type { RedisClient } from "./redis.js";
import { k } from "./keys.js";
import type { Session } from "./types.js";

// Redis data layer for sessions. Replaces the reference's `sessions` table.
// Each session is a Hash; userSessions is a sorted set (score = created_at ms)
// so "latest session" and "sessions since T" are O(log n) range reads.

function msToIso(ms: string | null | undefined): string {
  const n = Number(ms);
  return Number.isNaN(n) ? new Date().toISOString() : new Date(n).toISOString();
}

function hashToSession(id: string, h: Record<string, string>): Session {
  return {
    id,
    user_id: h.user_id ?? "",
    tool_used: h.tool_used ?? null,
    knowledge_bases_used: h.knowledge_bases_used ? h.knowledge_bases_used.split("|").filter(Boolean) : [],
    chunks_added: Number(h.chunks_added ?? 0),
    chunks_superseded: Number(h.chunks_superseded ?? 0),
    session_summary: h.session_summary ?? null,
    created_at: msToIso(h.created_at),
  };
}

export interface CreateSessionInput {
  user_id: string;
  tool_used?: string | null;
  knowledge_bases_used: string[];
  session_summary?: string | null;
}

export async function createSession(
  redis: RedisClient,
  input: CreateSessionInput
): Promise<Session> {
  const id = randomUUID();
  const now = Date.now();
  const fields: string[] = [
    "user_id", input.user_id,
    "knowledge_bases_used", input.knowledge_bases_used.join("|"),
    "chunks_added", "0",
    "chunks_superseded", "0",
    "created_at", String(now),
  ];
  if (input.tool_used) fields.push("tool_used", input.tool_used);
  if (input.session_summary) fields.push("session_summary", input.session_summary);

  await redis.sendCommand(["HSET", k.session(id), ...fields]);
  await redis.zAdd(k.userSessions(input.user_id), { score: now, value: id });
  return (await getSession(redis, id))!;
}

export async function getSession(redis: RedisClient, id: string): Promise<Session | null> {
  const h = (await redis.hGetAll(k.session(id))) as Record<string, string>;
  if (!h || Object.keys(h).length === 0) return null;
  return hashToSession(id, h);
}

export async function updateSessionCounts(
  redis: RedisClient,
  id: string,
  counts: { chunks_added?: number; chunks_superseded?: number }
): Promise<void> {
  const fields: string[] = [];
  if (counts.chunks_added != null) fields.push("chunks_added", String(counts.chunks_added));
  if (counts.chunks_superseded != null)
    fields.push("chunks_superseded", String(counts.chunks_superseded));
  if (fields.length === 0) return;
  await redis.sendCommand(["HSET", k.session(id), ...fields]);
}

export async function getLatestSession(redis: RedisClient, userId: string): Promise<Session | null> {
  const ids = (await redis.sendCommand([
    "ZREVRANGE",
    k.userSessions(userId),
    "0",
    "0",
  ])) as string[];
  if (!ids || ids.length === 0) return null;
  return getSession(redis, ids[0]);
}

// Sessions created at or after `sinceMs`, newest first, capped at `limit`.
export async function getSessionsSince(
  redis: RedisClient,
  userId: string,
  sinceMs: number,
  limit = 20
): Promise<Session[]> {
  const ids = (await redis.sendCommand([
    "ZRANGEBYSCORE",
    k.userSessions(userId),
    String(sinceMs),
    "+inf",
  ])) as string[];
  if (!ids || ids.length === 0) return [];
  const ordered = ids.reverse().slice(0, limit);
  const out: Session[] = [];
  for (const id of ordered) {
    const s = await getSession(redis, id);
    if (s) out.push(s);
  }
  return out;
}
