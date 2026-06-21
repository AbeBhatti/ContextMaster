import { randomUUID } from "node:crypto";
import type { RedisClient } from "./redis.js";
import { k } from "./keys.js";
import type { Workspace } from "./types.js";

// Redis data layer for workspaces. Replaces the reference's `workspaces` table.
// Each user has a Set of workspace ids (userWorkspaces) for owned workspaces;
// membership in others is recorded in workspaceMembers (Hash userId -> role).
// Full org/member/invite management lands in phase 6 — this is the minimal
// surface the MCP loop needs (default workspace + KB containment).

function msToIso(ms: string | null | undefined): string {
  const n = Number(ms);
  return Number.isNaN(n) ? new Date().toISOString() : new Date(n).toISOString();
}

export function hashToWorkspace(id: string, h: Record<string, string>): Workspace {
  return {
    id,
    name: h.name ?? "",
    description: h.description ?? null,
    owner_id: h.owner_id ?? "",
    organization_id: h.organization_id ?? null,
    is_default: h.is_default === "1" || h.is_default === "true",
    created_at: msToIso(h.created_at),
    updated_at: msToIso(h.updated_at),
  };
}

export async function getWorkspace(redis: RedisClient, id: string): Promise<Workspace | null> {
  const h = (await redis.hGetAll(k.workspace(id))) as Record<string, string>;
  if (!h || Object.keys(h).length === 0) return null;
  return hashToWorkspace(id, h);
}

export interface CreateWorkspaceInput {
  name: string;
  owner_id: string;
  description?: string | null;
  organization_id?: string | null;
  is_default?: boolean;
}

export async function createWorkspace(
  redis: RedisClient,
  input: CreateWorkspaceInput
): Promise<Workspace> {
  const id = randomUUID();
  const now = Date.now();
  const fields: string[] = [
    "name", input.name,
    "owner_id", input.owner_id,
    "is_default", input.is_default ? "1" : "0",
    "retrieval_scope", "open",
    "created_at", String(now),
    "updated_at", String(now),
  ];
  if (input.description) fields.push("description", input.description);
  if (input.organization_id) fields.push("organization_id", input.organization_id);

  await redis.sendCommand(["HSET", k.workspace(id), ...fields]);
  await redis.sAdd(k.userWorkspaces(input.owner_id), id);
  return (await getWorkspace(redis, id))!;
}

// All workspace ids the user can reach: owned + direct member. Org-based
// access is added in phase 6.
export async function getUserWorkspaceIds(redis: RedisClient, userId: string): Promise<string[]> {
  const owned = (await redis.sMembers(k.userWorkspaces(userId))) as string[];
  // Direct memberships aren't indexed per-user yet (phase 6 adds the reverse
  // set); owned workspaces are the only path in the single-user dev model.
  return Array.from(new Set(owned));
}

export async function listUserWorkspaces(redis: RedisClient, userId: string): Promise<Workspace[]> {
  const ids = await getUserWorkspaceIds(redis, userId);
  const out: Workspace[] = [];
  for (const id of ids) {
    const ws = await getWorkspace(redis, id);
    if (ws) out.push(ws);
  }
  return out;
}

export async function getDefaultWorkspace(
  redis: RedisClient,
  userId: string
): Promise<Workspace | null> {
  const all = await listUserWorkspaces(redis, userId);
  return all.find((w) => w.is_default) ?? all[0] ?? null;
}

// Read the raw retrieval_scope flag ('open' | 'restricted'). Stored on the
// hash but not part of the Workspace type the reference exposes elsewhere.
export async function getRetrievalScope(redis: RedisClient, id: string): Promise<string> {
  const v = (await redis.hGet(k.workspace(id), "retrieval_scope")) as string | null;
  return v ?? "open";
}
