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
    conversation_text: h.conversation_text ?? null,
    created_at: msToIso(h.created_at),
  };
}

export interface CreateSessionInput {
  user_id: string;
  tool_used?: string | null;
  knowledge_bases_used: string[];
  session_summary?: string | null;
  // Raw transcript kept on the session row so a future re-extraction pass can
  // pick it up without the user resending (matches the reference's
  // sessions.conversation_text column populated by the commit-raw worker).
  conversation_text?: string | null;
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
  if (input.conversation_text) fields.push("conversation_text", input.conversation_text);

  await redis.sendCommand(["HSET", k.session(id), ...fields]);
  await redis.zAdd(k.userSessions(input.user_id), { score: now, value: id });
  // Index under each KB so workspace history can find sessions by KB without a
  // scan (replaces the reference's .overlaps("knowledge_bases_used", kbIds)).
  for (const kbId of input.knowledge_bases_used) {
    if (kbId) await redis.zAdd(k.kbSessions(kbId), { score: now, value: id });
  }
  return (await getSession(redis, id))!;
}

export async function getSession(redis: RedisClient, id: string): Promise<Session | null> {
  const h = (await redis.hGetAll(k.session(id))) as Record<string, string>;
  if (!h || Object.keys(h).length === 0) return null;
  return hashToSession(id, h);
}

// Server-side path: link a session to the processing job that produced it, so
// the dashboard's history rows can offer View Conversation / Re-extract.
export async function setSessionJob(
  redis: RedisClient,
  sessionId: string,
  jobId: string
): Promise<void> {
  await redis.set(k.sessionJob(sessionId), jobId);
}

export async function getSessionJobId(redis: RedisClient, sessionId: string): Promise<string | null> {
  return (await redis.get(k.sessionJob(sessionId))) as string | null;
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

// Sessions whose knowledge_bases_used overlaps the given KB ids, newest first.
// Used by the dashboard's workspace history (GET /api/workspaces/:id/history).
// Merges the per-KB sorted sets, dedups, sorts by created_at desc.
export async function getSessionsByKbs(
  redis: RedisClient,
  kbIds: string[],
  limit = 50
): Promise<Session[]> {
  if (kbIds.length === 0) return [];
  const idSet = new Set<string>();
  for (const kbId of kbIds) {
    const ids = (await redis.sendCommand([
      "ZREVRANGE", k.kbSessions(kbId), "0", "-1",
    ])) as string[];
    for (const id of ids ?? []) idSet.add(id);
  }
  const out: Session[] = [];
  for (const id of idSet) {
    const s = await getSession(redis, id);
    if (s) out.push(s);
  }
  out.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return out.slice(0, limit);
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
