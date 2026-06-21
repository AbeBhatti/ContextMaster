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
  if (input.organization_id) await redis.sAdd(k.orgWorkspaces(input.organization_id), id);
  return (await getWorkspace(redis, id))!;
}

// Update mutable workspace fields (name / description / retrieval_scope).
export async function updateWorkspace(
  redis: RedisClient,
  id: string,
  fields: { name?: string; description?: string; retrieval_scope?: string }
): Promise<Workspace | null> {
  const args: string[] = [];
  if (fields.name != null) args.push("name", fields.name);
  if (fields.description != null) args.push("description", fields.description);
  if (fields.retrieval_scope != null) args.push("retrieval_scope", fields.retrieval_scope);
  args.push("updated_at", String(Date.now()));
  await redis.sendCommand(["HSET", k.workspace(id), ...args]);
  return getWorkspace(redis, id);
}

// Delete a workspace and detach it from its owner / org / member reverse-sets.
export async function deleteWorkspace(redis: RedisClient, ws: Workspace): Promise<void> {
  await redis.del(k.workspace(ws.id));
  await redis.sRem(k.userWorkspaces(ws.owner_id), ws.id);
  if (ws.organization_id) await redis.sRem(k.orgWorkspaces(ws.organization_id), ws.id);
  // Tear down member reverse-sets, then the members hash + kbs set.
  const memberIds = await getWorkspaceMemberIds(redis, ws.id);
  for (const uid of memberIds) await redis.sRem(k.userWorkspaceMemberships(uid), ws.id);
  await redis.del(k.workspaceMembers(ws.id));
  await redis.del(k.workspaceKbs(ws.id));
}

// ---- membership ----------------------------------------------------

export async function addWorkspaceMember(
  redis: RedisClient,
  workspaceId: string,
  userId: string,
  role: string
): Promise<void> {
  await redis.hSet(k.workspaceMembers(workspaceId), userId, role);
  await redis.sAdd(k.userWorkspaceMemberships(userId), workspaceId);
}

export async function removeWorkspaceMember(
  redis: RedisClient,
  workspaceId: string,
  userId: string
): Promise<void> {
  await redis.hDel(k.workspaceMembers(workspaceId), userId);
  await redis.sRem(k.userWorkspaceMemberships(userId), workspaceId);
}

export async function getWorkspaceMemberRole(
  redis: RedisClient,
  workspaceId: string,
  userId: string
): Promise<string | null> {
  return (await redis.hGet(k.workspaceMembers(workspaceId), userId)) as string | null;
}

export async function getWorkspaceMemberIds(
  redis: RedisClient,
  workspaceId: string
): Promise<string[]> {
  const h = (await redis.hGetAll(k.workspaceMembers(workspaceId))) as Record<string, string>;
  return Object.keys(h ?? {});
}

export interface WorkspaceMemberEntry {
  user_id: string;
  role: string;
}

export async function getWorkspaceMembers(
  redis: RedisClient,
  workspaceId: string
): Promise<WorkspaceMemberEntry[]> {
  const h = (await redis.hGetAll(k.workspaceMembers(workspaceId))) as Record<string, string>;
  return Object.entries(h ?? {}).map(([user_id, role]) => ({ user_id, role }));
}

// All workspaces hosted by an organization (resolves orgWorkspaces Set).
export async function getWorkspacesByOrg(
  redis: RedisClient,
  orgId: string
): Promise<Workspace[]> {
  const ids = (await redis.sMembers(k.orgWorkspaces(orgId))) as string[];
  const out: Workspace[] = [];
  for (const id of ids) {
    const ws = await getWorkspace(redis, id);
    if (ws) out.push(ws);
  }
  return out;
}

// All workspace ids the user can reach: owned + direct member + via org
// membership. The reverse per-user sets (userWorkspaceMemberships / userOrgs)
// keep this O(sets) instead of scanning every workspace.
export async function getUserWorkspaceIds(redis: RedisClient, userId: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const id of (await redis.sMembers(k.userWorkspaces(userId))) as string[]) ids.add(id);
  for (const id of (await redis.sMembers(k.userWorkspaceMemberships(userId))) as string[]) ids.add(id);
  const orgIds = (await redis.sMembers(k.userOrgs(userId))) as string[];
  for (const orgId of orgIds) {
    for (const wsId of (await redis.sMembers(k.orgWorkspaces(orgId))) as string[]) ids.add(wsId);
  }
  return Array.from(ids);
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
