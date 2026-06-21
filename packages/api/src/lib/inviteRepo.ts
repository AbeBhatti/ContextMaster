import { randomUUID, randomBytes } from "node:crypto";
import type { RedisClient } from "./redis.js";
import { k } from "./keys.js";

// Redis data layer for workspace invites. Replaces the reference's `invites`
// table. Each invite is a Hash keyed by its token (the token is the public
// handle used in the invite link); workspaceInvites is a per-workspace Set of
// tokens for listing.

export interface Invite {
  id: string;
  workspace_id: string;
  email: string;
  token: string;
  invited_by: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

function msToIso(ms: string | null | undefined): string {
  const n = Number(ms);
  return Number.isNaN(n) ? new Date().toISOString() : new Date(n).toISOString();
}

function hashToInvite(h: Record<string, string>): Invite {
  return {
    id: h.id ?? "",
    workspace_id: h.workspace_id ?? "",
    email: h.email ?? "",
    token: h.token ?? "",
    invited_by: h.invited_by ?? "",
    role: h.role ?? "editor",
    expires_at: msToIso(h.expires_at),
    accepted_at: h.accepted_at ? msToIso(h.accepted_at) : null,
    created_at: msToIso(h.created_at),
  };
}

export async function createInvite(
  redis: RedisClient,
  input: { workspace_id: string; email: string; invited_by: string; role: string; ttlMs?: number }
): Promise<Invite> {
  const id = randomUUID();
  const token = randomBytes(24).toString("hex");
  const now = Date.now();
  const ttl = input.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
  const expiresAt = now + ttl;

  await redis.sendCommand([
    "HSET", k.invite(token),
    "id", id,
    "workspace_id", input.workspace_id,
    "email", input.email,
    "token", token,
    "invited_by", input.invited_by,
    "role", input.role,
    "expires_at", String(expiresAt),
    "created_at", String(now),
  ]);
  await redis.sAdd(k.workspaceInvites(input.workspace_id), token);
  return (await getInviteByToken(redis, token))!;
}

export async function getInviteByToken(redis: RedisClient, token: string): Promise<Invite | null> {
  const h = (await redis.hGetAll(k.invite(token))) as Record<string, string>;
  if (!h || Object.keys(h).length === 0) return null;
  return hashToInvite(h);
}

export async function markInviteAccepted(redis: RedisClient, token: string): Promise<void> {
  await redis.hSet(k.invite(token), "accepted_at", String(Date.now()));
}

// Active (unaccepted, unexpired) invites for a workspace.
export async function listActiveInvites(redis: RedisClient, workspaceId: string): Promise<Invite[]> {
  const tokens = (await redis.sMembers(k.workspaceInvites(workspaceId))) as string[];
  const now = Date.now();
  const out: Invite[] = [];
  for (const token of tokens) {
    const invite = await getInviteByToken(redis, token);
    if (!invite) {
      await redis.sRem(k.workspaceInvites(workspaceId), token);
      continue;
    }
    if (invite.accepted_at) continue;
    if (new Date(invite.expires_at).getTime() <= now) continue;
    out.push(invite);
  }
  return out;
}

// Delete an invite by its id within a workspace (the dashboard passes the id).
export async function deleteInviteById(
  redis: RedisClient,
  workspaceId: string,
  inviteId: string
): Promise<boolean> {
  const tokens = (await redis.sMembers(k.workspaceInvites(workspaceId))) as string[];
  for (const token of tokens) {
    const invite = await getInviteByToken(redis, token);
    if (invite && invite.id === inviteId) {
      await redis.del(k.invite(token));
      await redis.sRem(k.workspaceInvites(workspaceId), token);
      return true;
    }
  }
  return false;
}
