import type { RedisClient } from "./redis.js";
import { k } from "./keys.js";
import { getWorkspace } from "./workspaceRepo.js";
import type { Workspace } from "./types.js";

// Workspace role / access resolution — Redis port of the reference's
// lib/access.ts. The single-user dev model only exercises the "owner" path;
// the member + organization paths are wired here so phase 6 just has to
// populate workspaceMembers / org membership data.

export type WorkspaceRole = "owner" | "editor" | "viewer";

export interface WorkspaceAccess {
  workspace: Workspace;
  role: WorkspaceRole;
  isOwner: boolean;
  via: "owner" | "member" | "organization";
}

const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

export function meetsMinimumRole(role: WorkspaceRole, min: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export async function getWorkspaceAccess(
  redis: RedisClient,
  workspaceId: string,
  userId: string
): Promise<WorkspaceAccess | null> {
  const workspace = await getWorkspace(redis, workspaceId);
  if (!workspace) return null;

  if (workspace.owner_id === userId) {
    return { workspace, role: "owner", isOwner: true, via: "owner" };
  }

  const memberRole = (await redis.hGet(k.workspaceMembers(workspaceId), userId)) as string | null;
  if (memberRole) {
    const role = (memberRole as WorkspaceRole) ?? "editor";
    return { workspace, role, isOwner: role === "owner", via: "member" };
  }

  if (workspace.organization_id) {
    const orgOwner = (await redis.hGet(k.org(workspace.organization_id), "owner_id")) as
      | string
      | null;
    if (orgOwner === userId) {
      return { workspace, role: "owner", isOwner: true, via: "organization" };
    }
    const orgRole = (await redis.hGet(k.orgMembers(workspace.organization_id), userId)) as
      | string
      | null;
    if (orgRole) {
      const role: WorkspaceRole = orgRole === "owner" || orgRole === "admin" ? "owner" : "editor";
      return { workspace, role, isOwner: role === "owner", via: "organization" };
    }
  }

  return null;
}
