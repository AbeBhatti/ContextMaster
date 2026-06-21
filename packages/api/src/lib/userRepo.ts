import { randomUUID } from "node:crypto";
import type { RedisClient } from "./redis.js";
import { k } from "./keys.js";
import type { User } from "./types.js";

// Redis data layer for users. Replaces the reference's `users` Postgres table.
// clerk_id and email are unique in the reference schema, so we keep reverse
// lookup string keys (userByClerk / userByEmail) pointing at the canonical id.

function msToIso(ms: string | null | undefined): string {
  const n = Number(ms);
  return Number.isNaN(n) ? new Date().toISOString() : new Date(n).toISOString();
}

function hashToUser(id: string, h: Record<string, string>): User {
  return {
    id,
    clerk_id: h.clerk_id ?? "",
    email: h.email ?? "",
    name: h.name ?? null,
    created_at: msToIso(h.created_at),
    updated_at: msToIso(h.updated_at),
  };
}

export async function getUser(redis: RedisClient, id: string): Promise<User | null> {
  const h = (await redis.hGetAll(k.user(id))) as Record<string, string>;
  if (!h || Object.keys(h).length === 0) return null;
  return hashToUser(id, h);
}

export async function getUserByClerkId(redis: RedisClient, clerkId: string): Promise<User | null> {
  const id = (await redis.get(k.userByClerk(clerkId))) as string | null;
  if (!id) return null;
  return getUser(redis, id);
}

export async function getUserByEmail(redis: RedisClient, email: string): Promise<User | null> {
  const id = (await redis.get(k.userByEmail(email))) as string | null;
  if (!id) return null;
  return getUser(redis, id);
}

// Batch hydrate users by id (member-list enrichment). Returns a Map for O(1)
// joins; missing ids are simply absent from the map.
export async function getUsersByIds(
  redis: RedisClient,
  ids: string[]
): Promise<Map<string, User>> {
  const map = new Map<string, User>();
  for (const id of ids) {
    const u = await getUser(redis, id);
    if (u) map.set(id, u);
  }
  return map;
}

export interface CreateUserInput {
  clerk_id: string;
  email: string;
  name?: string | null;
  id?: string;
}

export async function createUser(redis: RedisClient, input: CreateUserInput): Promise<User> {
  const id = input.id ?? randomUUID();
  const now = Date.now();
  const fields: string[] = [
    "clerk_id", input.clerk_id,
    "email", input.email,
    "created_at", String(now),
    "updated_at", String(now),
  ];
  if (input.name) fields.push("name", input.name);

  await redis.sendCommand(["HSET", k.user(id), ...fields]);
  await redis.set(k.userByClerk(input.clerk_id), id);
  await redis.set(k.userByEmail(input.email), id);
  return (await getUser(redis, id))!;
}

// Idempotent get-or-create keyed on clerk_id. Used by the AUTH_BYPASS bootstrap
// and (phase 7) by the Clerk webhook to upsert real users.
export async function ensureUser(redis: RedisClient, input: CreateUserInput): Promise<User> {
  const existing = await getUserByClerkId(redis, input.clerk_id);
  if (existing) return existing;
  return createUser(redis, input);
}

// Link a Clerk identity onto a user that already existed by email (e.g. created
// before Clerk linking). Mirrors the reference's clerk_id back-fill update:
// stamps clerk_id + name, refreshes updated_at, and points the reverse
// userByClerk lookup at the canonical id.
export async function linkClerkId(
  redis: RedisClient,
  id: string,
  clerkId: string,
  name?: string | null
): Promise<User> {
  const fields: string[] = ["clerk_id", clerkId, "updated_at", String(Date.now())];
  if (name) fields.push("name", name);
  await redis.sendCommand(["HSET", k.user(id), ...fields]);
  await redis.set(k.userByClerk(clerkId), id);
  return (await getUser(redis, id))!;
}
