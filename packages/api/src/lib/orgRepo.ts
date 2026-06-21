import { randomUUID } from "node:crypto";
import type { RedisClient } from "./redis.js";
import { k } from "./keys.js";

// Redis data layer for organizations. Replaces the reference's
// `organizations` + `organization_members` tables. Each org is a Hash; members
// live in a per-org Hash (userId -> role) with a reverse per-user Set
// (userOrgs) so a user's orgs resolve without a scan.

export interface Organization {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export type OrgRole = "owner" | "admin" | "member";

function msToIso(ms: string | null | undefined): string {
  const n = Number(ms);
  return Number.isNaN(n) ? new Date().toISOString() : new Date(n).toISOString();
}

function hashToOrg(id: string, h: Record<string, string>): Organization {
  return {
    id,
    name: h.name ?? "",
    owner_id: h.owner_id ?? "",
    created_at: msToIso(h.created_at),
    updated_at: msToIso(h.updated_at),
  };
}

export async function getOrg(redis: RedisClient, id: string): Promise<Organization | null> {
  const h = (await redis.hGetAll(k.org(id))) as Record<string, string>;
  if (!h || Object.keys(h).length === 0) return null;
  return hashToOrg(id, h);
}

export async function createOrg(
  redis: RedisClient,
  input: { name: string; owner_id: string }
): Promise<Organization> {
  const id = randomUUID();
  const now = Date.now();
  await redis.sendCommand([
    "HSET", k.org(id),
    "name", input.name,
    "owner_id", input.owner_id,
    "created_at", String(now),
    "updated_at", String(now),
  ]);
  return (await getOrg(redis, id))!;
}

export async function updateOrg(
  redis: RedisClient,
  id: string,
  fields: { name?: string }
): Promise<Organization | null> {
  const args: string[] = [];
  if (fields.name != null) args.push("name", fields.name);
  args.push("updated_at", String(Date.now()));
  await redis.sendCommand(["HSET", k.org(id), ...args]);
  return getOrg(redis, id);
}

export async function deleteOrg(redis: RedisClient, id: string): Promise<void> {
  const memberIds = await getOrgMemberIds(redis, id);
  for (const uid of memberIds) await redis.sRem(k.userOrgs(uid), id);
  await redis.del(k.orgMembers(id));
  await redis.del(k.orgWorkspaces(id));
  await redis.del(k.org(id));
}

// ---- membership ----------------------------------------------------

export async function addOrgMember(
  redis: RedisClient,
  orgId: string,
  userId: string,
  role: OrgRole
): Promise<void> {
  await redis.hSet(k.orgMembers(orgId), userId, role);
  await redis.sAdd(k.userOrgs(userId), orgId);
}

export async function removeOrgMember(
  redis: RedisClient,
  orgId: string,
  userId: string
): Promise<void> {
  await redis.hDel(k.orgMembers(orgId), userId);
  await redis.sRem(k.userOrgs(userId), orgId);
}

export async function getOrgMemberRole(
  redis: RedisClient,
  orgId: string,
  userId: string
): Promise<string | null> {
  return (await redis.hGet(k.orgMembers(orgId), userId)) as string | null;
}

export async function getOrgMemberIds(redis: RedisClient, orgId: string): Promise<string[]> {
  const h = (await redis.hGetAll(k.orgMembers(orgId))) as Record<string, string>;
  return Object.keys(h ?? {});
}

export interface OrgMemberEntry {
  user_id: string;
  role: string;
}

export async function getOrgMembers(redis: RedisClient, orgId: string): Promise<OrgMemberEntry[]> {
  const h = (await redis.hGetAll(k.orgMembers(orgId))) as Record<string, string>;
  return Object.entries(h ?? {}).map(([user_id, role]) => ({ user_id, role }));
}

// Whether a user has at least member-level access to an org (owner or member
// row). Used to gate workspace creation under an org.
export async function hasOrgAccess(
  redis: RedisClient,
  orgId: string,
  userId: string
): Promise<boolean> {
  const org = await getOrg(redis, orgId);
  if (!org) return false;
  if (org.owner_id === userId) return true;
  return (await getOrgMemberRole(redis, orgId, userId)) != null;
}

// Orgs the user owns or is a member of (deduped).
export async function getOrgsForUser(redis: RedisClient, userId: string): Promise<Organization[]> {
  const orgIds = new Set<string>((await redis.sMembers(k.userOrgs(userId))) as string[]);
  // Reverse set covers membership; owned orgs are also added there at creation,
  // but guard the older-owner-without-member-row case by including any owned id
  // already present. (Creation always adds the owner to userOrgs.)
  const out: Organization[] = [];
  for (const id of orgIds) {
    const org = await getOrg(redis, id);
    if (org) out.push(org);
  }
  return out;
}
