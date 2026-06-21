import { Router, type Request, type Response } from "express";
import { getRedis } from "../lib/redis.js";
import { descriptionForNewKb } from "../lib/kbTemplates.js";
import * as orgRepo from "../lib/orgRepo.js";
import * as workspaceRepo from "../lib/workspaceRepo.js";
import * as kbRepo from "../lib/kbRepo.js";
import { getUsersByIds, getUserByEmail } from "../lib/userRepo.js";

// Redis port of the reference's routes/organizations.ts. Org + member CRUD and
// org-shared KBs, backed by orgRepo/workspaceRepo/kbRepo. Shared KBs live in a
// hidden per-org `_shared::<orgId>` workspace, exactly like the reference, so
// check_memory's org-shared scan finds them.

export const organizationsRouter = Router();

type OrgRole = "owner" | "admin" | "member";

interface OrgAccess {
  org: orgRepo.Organization;
  role: OrgRole;
  isOwner: boolean;
}

async function getOrgAccess(orgId: string, userId: string): Promise<OrgAccess | null> {
  const redis = getRedis();
  const org = await orgRepo.getOrg(redis, orgId);
  if (!org) return null;
  if (org.owner_id === userId) return { org, role: "owner", isOwner: true };
  const role = await orgRepo.getOrgMemberRole(redis, orgId, userId);
  if (!role) return null;
  return { org, role: (role as OrgRole) ?? "member", isOwner: false };
}

async function requireOrgAccess(
  req: Request,
  res: Response,
  orgId: string,
  minRole: OrgRole = "member"
): Promise<OrgAccess | null> {
  const access = await getOrgAccess(orgId, req.user!.id);
  if (!access) {
    res.status(403).json({ error: "No access to this organization" });
    return null;
  }
  const rank: Record<OrgRole, number> = { member: 1, admin: 2, owner: 3 };
  if (rank[access.role] < rank[minRole]) {
    res.status(403).json({ error: `${minRole} access required` });
    return null;
  }
  return access;
}

// POST /api/organizations — create
organizationsRouter.post("/", async (req: Request, res: Response) => {
  const redis = getRedis();
  const { name } = req.body;
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const org = await orgRepo.createOrg(redis, { name, owner_id: req.user!.id });
  // Add creator as a member with role 'owner' for clean joins.
  await orgRepo.addOrgMember(redis, org.id, req.user!.id, "owner");
  res.status(201).json(org);
});

// GET /api/organizations — list user's orgs
organizationsRouter.get("/", async (req: Request, res: Response) => {
  const redis = getRedis();
  const userId = req.user!.id;
  const orgs = await orgRepo.getOrgsForUser(redis, userId);
  const out = [];
  for (const o of orgs) {
    const memberIds = await orgRepo.getOrgMemberIds(redis, o.id);
    const workspaces = await workspaceRepo.getWorkspacesByOrg(redis, o.id);
    out.push({
      ...o,
      role: o.owner_id === userId ? "owner" : "member",
      member_count: memberIds.length,
      workspace_count: workspaces.length,
    });
  }
  res.json({ organizations: out });
});

// GET /api/organizations/:id — detail (members, workspaces, shared KBs)
organizationsRouter.get("/:id", async (req: Request, res: Response) => {
  const redis = getRedis();
  const access = await requireOrgAccess(req, res, req.params.id);
  if (!access) return;

  const members = await orgRepo.getOrgMembers(redis, req.params.id);
  const workspaces = await workspaceRepo.getWorkspacesByOrg(redis, req.params.id);

  let sharedKbs: any[] = [];
  for (const ws of workspaces) {
    const kbs = await kbRepo.getKbsByWorkspace(redis, ws.id);
    sharedKbs.push(...kbs.filter((kb) => kb.is_shared && !kb.name.startsWith("_")));
  }

  // Enrich members + implicit owner entry.
  const memberUserIds = new Set(members.map((m) => m.user_id));
  const users = await getUsersByIds(redis, [
    ...memberUserIds,
    access.org.owner_id,
  ]);
  let ownerEntry: any = null;
  if (!memberUserIds.has(access.org.owner_id)) {
    const ownerUser = users.get(access.org.owner_id);
    if (ownerUser) {
      ownerEntry = {
        user_id: access.org.owner_id,
        role: "owner",
        name: ownerUser.name ?? ownerUser.email,
        email: ownerUser.email,
        joined_at: access.org.created_at,
      };
    }
  }
  const memberList = members.map((m) => {
    const u = users.get(m.user_id);
    return {
      user_id: m.user_id,
      role: m.role,
      name: u?.name ?? u?.email ?? "Member",
      email: u?.email,
    };
  });

  res.json({
    ...access.org,
    role: access.role,
    members: ownerEntry ? [ownerEntry, ...memberList] : memberList,
    workspaces: workspaces.filter((w) => !w.name.startsWith("_")),
    shared_knowledge_bases: sharedKbs,
  });
});

// PATCH /api/organizations/:id — rename
organizationsRouter.patch("/:id", async (req: Request, res: Response) => {
  const access = await requireOrgAccess(req, res, req.params.id, "admin");
  if (!access) return;
  const { name } = req.body;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const org = await orgRepo.updateOrg(getRedis(), req.params.id, { name });
  res.json(org);
});

// DELETE /api/organizations/:id — owner only
organizationsRouter.delete("/:id", async (req: Request, res: Response) => {
  const access = await requireOrgAccess(req, res, req.params.id, "owner");
  if (!access) return;
  await orgRepo.deleteOrg(getRedis(), req.params.id);
  res.json({ success: true });
});

// POST /api/organizations/:id/members — add by email or user_id
organizationsRouter.post("/:id/members", async (req: Request, res: Response) => {
  const redis = getRedis();
  const access = await requireOrgAccess(req, res, req.params.id, "admin");
  if (!access) return;

  const { email, user_id, role } = req.body as {
    email?: string;
    user_id?: string;
    role?: string;
  };

  let targetUserId = user_id;
  if (!targetUserId && email) {
    const u = await getUserByEmail(redis, email);
    if (!u) {
      res.status(404).json({
        error: "No user with that email yet. They must sign up before being added.",
      });
      return;
    }
    targetUserId = u.id;
  }
  if (!targetUserId) {
    res.status(400).json({ error: "email or user_id is required" });
    return;
  }

  const existing = await orgRepo.getOrgMemberRole(redis, req.params.id, targetUserId);
  if (existing) {
    res.status(409).json({ error: "User is already a member" });
    return;
  }

  const insertRole =
    role && ["owner", "admin", "member"].includes(role) ? (role as orgRepo.OrgRole) : "member";
  await orgRepo.addOrgMember(redis, req.params.id, targetUserId, insertRole);
  res.status(201).json({
    organization_id: req.params.id,
    user_id: targetUserId,
    role: insertRole,
  });
});

// DELETE /api/organizations/:id/members/:userId
organizationsRouter.delete("/:id/members/:userId", async (req: Request, res: Response) => {
  const access = await requireOrgAccess(req, res, req.params.id, "admin");
  if (!access) return;
  if (req.params.userId === access.org.owner_id) {
    res.status(400).json({ error: "Cannot remove the organization owner" });
    return;
  }
  await orgRepo.removeOrgMember(getRedis(), req.params.id, req.params.userId);
  res.json({ success: true });
});

// PATCH /api/organizations/:id/members/:userId — change role
organizationsRouter.patch("/:id/members/:userId", async (req: Request, res: Response) => {
  const redis = getRedis();
  const access = await requireOrgAccess(req, res, req.params.id, "owner");
  if (!access) return;

  const { role } = req.body as { role?: string };
  if (!role || !["owner", "admin", "member"].includes(role)) {
    res.status(400).json({ error: "role must be one of: owner, admin, member" });
    return;
  }
  if (req.params.userId === access.org.owner_id) {
    res.status(400).json({ error: "Cannot change the role of the organization owner" });
    return;
  }
  const existing = await orgRepo.getOrgMemberRole(redis, req.params.id, req.params.userId);
  if (!existing) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  await orgRepo.addOrgMember(redis, req.params.id, req.params.userId, role as orgRepo.OrgRole);
  res.json({ organization_id: req.params.id, user_id: req.params.userId, role });
});

// POST /api/organizations/:id/shared-kbs — create a shared KB
organizationsRouter.post("/:id/shared-kbs", async (req: Request, res: Response) => {
  const redis = getRedis();
  const access = await requireOrgAccess(req, res, req.params.id, "admin");
  if (!access) return;

  const { name, description, kb_type } = req.body as {
    name?: string;
    description?: string;
    kb_type?: string;
  };
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  // Find or create the per-org hidden "shared" workspace (`_`-prefixed so it
  // stays out of sidebars + org workspace lists).
  const sharedWorkspaceName = `_shared::${req.params.id}`;
  const orgWorkspaces = await workspaceRepo.getWorkspacesByOrg(redis, req.params.id);
  let ws = orgWorkspaces.find((w) => w.name === sharedWorkspaceName) ?? null;
  if (!ws) {
    ws = await workspaceRepo.createWorkspace(redis, {
      name: sharedWorkspaceName,
      description: "Shared knowledge bases for the organization",
      owner_id: access.org.owner_id,
      organization_id: req.params.id,
      is_default: false,
    });
  }

  const sharedKbType = kb_type ?? "general";
  const kb = await kbRepo.createKb(redis, {
    workspace_id: ws.id,
    name,
    description: descriptionForNewKb(sharedKbType, description),
    kb_type: sharedKbType,
    is_shared: true,
  });
  res.status(201).json(kb);
});

// GET /api/organizations/:id/shared-kbs — list
organizationsRouter.get("/:id/shared-kbs", async (req: Request, res: Response) => {
  const redis = getRedis();
  const access = await requireOrgAccess(req, res, req.params.id);
  if (!access) return;

  const workspaces = await workspaceRepo.getWorkspacesByOrg(redis, req.params.id);
  const sharedKbs: any[] = [];
  for (const ws of workspaces) {
    const kbs = await kbRepo.getKbsByWorkspace(redis, ws.id);
    sharedKbs.push(...kbs.filter((kb) => kb.is_shared && !kb.name.startsWith("_")));
  }
  res.json({ shared_knowledge_bases: sharedKbs });
});
