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
