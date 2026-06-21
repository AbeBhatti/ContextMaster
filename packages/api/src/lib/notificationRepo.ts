import { randomUUID } from "node:crypto";
import type { RedisClient } from "./redis.js";
import { k } from "./keys.js";

// Redis data layer for notifications. Replaces the reference's `notifications`
// table. Each notification is a Hash; userNotifications is a per-user sorted
// set (score = created_at ms) so "newest first" + paging are range reads.

export interface Notification {
  id: string;
  user_id: string;
  workspace_id: string | null;
  type: string;
  title: string;
  body: string | null;
  actor_id: string | null;
  read_at: string | null;
  created_at: string;
}

function msToIso(ms: string | null | undefined): string {
  const n = Number(ms);
  return Number.isNaN(n) ? new Date().toISOString() : new Date(n).toISOString();
}

function hashToNotification(id: string, h: Record<string, string>): Notification {
  return {
    id,
    user_id: h.user_id ?? "",
    workspace_id: h.workspace_id || null,
    type: h.type ?? "",
    title: h.title ?? "",
    body: h.body || null,
    actor_id: h.actor_id || null,
    read_at: h.read_at ? msToIso(h.read_at) : null,
    created_at: msToIso(h.created_at),
  };
}

export interface CreateNotificationInput {
  user_id: string;
  workspace_id: string | null;
  type: string;
  title: string;
  body?: string | null;
  actor_id?: string | null;
}

export async function createNotifications(
  redis: RedisClient,
  rows: CreateNotificationInput[]
): Promise<void> {
  const now = Date.now();
  for (const row of rows) {
    const id = randomUUID();
    const fields: string[] = [
      "user_id", row.user_id,
      "type", row.type,
      "title", row.title,
      "created_at", String(now),
    ];
    if (row.workspace_id) fields.push("workspace_id", row.workspace_id);
    if (row.body) fields.push("body", row.body);
    if (row.actor_id) fields.push("actor_id", row.actor_id);
    await redis.sendCommand(["HSET", k.notification(id), ...fields]);
    await redis.zAdd(k.userNotifications(row.user_id), { score: now, value: id });
  }
}

export async function getNotification(redis: RedisClient, id: string): Promise<Notification | null> {
  const h = (await redis.hGetAll(k.notification(id))) as Record<string, string>;
  if (!h || Object.keys(h).length === 0) return null;
  return hashToNotification(id, h);
}

// Newest-first page of a user's notifications. `onlyUnread` filters after the
// range read (post-filter mirrors the reference's `.is(read_at, null)`).
export async function listNotifications(
  redis: RedisClient,
  userId: string,
  opts: { limit: number; offset: number; onlyUnread: boolean }
): Promise<{ notifications: Notification[]; total: number }> {
  const allIds = (await redis.sendCommand([
    "ZREVRANGE", k.userNotifications(userId), "0", "-1",
  ])) as string[];

  const all: Notification[] = [];
  for (const id of allIds ?? []) {
    const n = await getNotification(redis, id);
    if (n) all.push(n);
  }
  const filtered = opts.onlyUnread ? all.filter((n) => !n.read_at) : all;
  const page = filtered.slice(opts.offset, opts.offset + opts.limit);
  return { notifications: page, total: filtered.length };
}

export async function unreadCount(redis: RedisClient, userId: string): Promise<number> {
  const ids = (await redis.sendCommand([
    "ZRANGE", k.userNotifications(userId), "0", "-1",
  ])) as string[];
  let count = 0;
  for (const id of ids ?? []) {
    const readAt = (await redis.hGet(k.notification(id), "read_at")) as string | null;
    if (!readAt) count++;
  }
  return count;
}

export async function markRead(
  redis: RedisClient,
  userId: string,
  opts: { ids?: string[]; all?: boolean }
): Promise<void> {
  const now = String(Date.now());
  if (opts.all) {
    const ids = (await redis.sendCommand([
      "ZRANGE", k.userNotifications(userId), "0", "-1",
    ])) as string[];
    for (const id of ids ?? []) {
      const readAt = (await redis.hGet(k.notification(id), "read_at")) as string | null;
      if (!readAt) await redis.hSet(k.notification(id), "read_at", now);
    }
    return;
  }
  for (const id of opts.ids ?? []) {
    // Only mark this user's own notifications (ownership guard).
    const owner = (await redis.hGet(k.notification(id), "user_id")) as string | null;
    if (owner === userId) await redis.hSet(k.notification(id), "read_at", now);
  }
}
