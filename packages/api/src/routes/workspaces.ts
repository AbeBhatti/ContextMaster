import { Router, type Request, type Response } from "express";
import multer from "multer";
import { randomBytes } from "node:crypto";
import { getRedis } from "../lib/redis.js";
import { generateEmbedding, generateEmbeddings } from "../services/embeddingService.js";
import { processDocument } from "../services/documentService.js";
import { deleteKnowledgeBase } from "../services/chunkService.js";
import {
  type WorkspaceAccess,
  type WorkspaceRole,
  getKbWorkspaceAccess,
  getWorkspaceAccess,
  meetsMinimumRole,
} from "../lib/access.js";
import { notify } from "../services/notificationService.js";
import { sendInviteEmail } from "../services/emailService.js";
import { descriptionForNewKb } from "../lib/kbTemplates.js";
import { track } from "../lib/analytics.js";
import { enqueueJob, getJobDetail, listJobsByKbs, type JobDetail } from "../services/jobService.js";
import * as workspaceRepo from "../lib/workspaceRepo.js";
import * as kbRepo from "../lib/kbRepo.js";
import * as chunkRepo from "../lib/chunkRepo.js";
import * as docRepo from "../lib/docRepo.js";
import * as inviteRepo from "../lib/inviteRepo.js";
import * as sessionRepo from "../lib/sessionRepo.js";
import * as orgRepo from "../lib/orgRepo.js";
import { getUsersByIds } from "../lib/userRepo.js";

// Redis port of the reference's routes/workspaces.ts. Every endpoint keeps the
// same path + response shape; the data layer is the lib/*Repo modules instead
// of Supabase. Documents live on local disk (docRepo) with the path in Redis.

const APP_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3000";

export const workspacesRouter = Router();

// Public, unauthenticated routes — mounted before auth in index.ts so
// signed-out users can preview an invite before signing in.
export const publicInvitesRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// ============================================
// Permission helpers
// ============================================

async function requireAccess(
  req: Request,
  res: Response,
  workspaceId: string,
  minRole: WorkspaceRole = "viewer"
): Promise<WorkspaceAccess | null> {
  const access = await getWorkspaceAccess(getRedis(), workspaceId, req.user!.id);
  if (!access) {
    res.status(403).json({ error: "No access to this workspace" });
    return null;
  }
  if (!meetsMinimumRole(access.role, minRole)) {
    res.status(403).json({
      error:
        minRole === "editor"
          ? "You have view-only access to this workspace. Ask the workspace owner to upgrade your role to editor."
          : "Owner access required for this action.",
      role: access.role,
    });
    return null;
  }
  return access;
}

async function requireKbAccess(
  req: Request,
  res: Response,
  kbId: string,
  minRole: WorkspaceRole = "viewer"
): Promise<{ kb: any; access: WorkspaceAccess } | null> {
  const result = await getKbWorkspaceAccess(getRedis(), kbId, req.user!.id);
  if (!result) {
    res.status(403).json({ error: "No access to this knowledge base" });
    return null;
  }
  if (!meetsMinimumRole(result.access.role, minRole)) {
    res.status(403).json({
      error:
        minRole === "editor"
          ? "You have view-only access to this workspace. Ask the workspace owner to upgrade your role to editor."
          : "Owner access required for this action.",
      role: result.access.role,
    });
    return null;
  }
  return result;
}

// System KBs are managed by the platform — readable but never modified.
function rejectIfSystemKb(res: Response, kb: any): boolean {
  if (kb?.is_system) {
    res.status(403).json({
      error: "This is a system knowledge base and cannot be modified.",
    });
    return true;
  }
  return false;
}

// ============================================
// GET /api/workspaces — list user's workspaces
// ============================================
workspacesRouter.get("/workspaces", async (req: Request, res: Response) => {
  const redis = getRedis();
  const userId = req.user!.id;

  // getUserWorkspaceIds resolves owned + member + org-based access.
  const wsIds = await workspaceRepo.getUserWorkspaceIds(redis, userId);
  const workspaces: any[] = [];
  for (const id of wsIds) {
    const ws = await workspaceRepo.getWorkspace(redis, id);
    if (!ws) continue;
    if (typeof ws.name === "string" && ws.name.startsWith("_")) continue;
    workspaces.push(ws);
  }

  if (workspaces.length === 0) {
    res.json({ workspaces: [] });
    return;
  }

  const enriched: any[] = [];
  for (const ws of workspaces) {
    const kbs = (await kbRepo.getKbsByWorkspace(redis, ws.id)).filter(
      (kb) => !kb.name.startsWith("_")
    );
    const totalChunks = kbs.reduce((sum, kb) => sum + (kb.chunk_count ?? 0), 0);
    const lastUpdated = kbs.reduce<string | null>((latest, kb) => {
      if (!latest || (kb.updated_at && kb.updated_at > latest)) return kb.updated_at;
      return latest;
    }, null);

    const memberEntries = await workspaceRepo.getWorkspaceMembers(redis, ws.id);
    const memberUsers = await getUsersByIds(
      redis,
      memberEntries.map((m) => m.user_id)
    );
    const members = memberEntries.map((m) => {
      const u = memberUsers.get(m.user_id);
      return {
        user_id: m.user_id,
        name: u?.name ?? u?.email ?? "Member",
        email: u?.email,
      };
    });

    enriched.push({
      ...ws,
      kb_count: kbs.length,
      chunk_count: totalChunks,
      last_updated: lastUpdated ?? ws.updated_at,
      members,
      role: ws.owner_id === userId ? "owner" : "member",
    });
  }

  enriched.sort((a, b) => {
    if (a.is_default && !b.is_default) return -1;
    if (!a.is_default && b.is_default) return 1;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });

  res.json({ workspaces: enriched });
});

// ============================================
// POST /api/workspaces — create
// ============================================
workspacesRouter.post("/workspaces", async (req: Request, res: Response) => {
  const redis = getRedis();
  const { name, description, organization_id } = req.body;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  if (organization_id) {
    const hasAccess = await orgRepo.hasOrgAccess(redis, organization_id, req.user!.id);
    if (!hasAccess) {
      res.status(403).json({ error: "Not a member of the target organization" });
      return;
    }
  }

  const ws = await workspaceRepo.createWorkspace(redis, {
    name,
    description: description ?? null,
    owner_id: req.user!.id,
    organization_id: organization_id ?? null,
    is_default: false,
  });

  // Add owner as member too.
  await workspaceRepo.addWorkspaceMember(redis, ws.id, req.user!.id, "owner");

  res.status(201).json(ws);
});

// ============================================
// GET /api/workspaces/:id — detail
// ============================================
workspacesRouter.get("/workspaces/:id", async (req: Request, res: Response) => {
  const redis = getRedis();
  const access = await requireAccess(req, res, req.params.id);
  if (!access) return;

  const kbs = (await kbRepo.getKbsByWorkspace(redis, req.params.id))
    .filter((kb) => !kb.name.startsWith("_"))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  const memberEntries = await workspaceRepo.getWorkspaceMembers(redis, req.params.id);
  const memberUsers = await getUsersByIds(
    redis,
    memberEntries.map((m) => m.user_id)
  );

  res.json({
    ...access.workspace,
    role: access.role,
    knowledge_bases: kbs,
    members: memberEntries.map((m) => {
      const u = memberUsers.get(m.user_id);
      return {
        user_id: m.user_id,
        role: m.role,
        name: u?.name ?? u?.email ?? "Member",
        email: u?.email,
        joined_at: u?.created_at ?? null,
      };
    }),
  });
});

// ============================================
// PATCH /api/workspaces/:id — update
// ============================================
workspacesRouter.patch("/workspaces/:id", async (req: Request, res: Response) => {
  const access = await requireAccess(req, res, req.params.id, "owner");
  if (!access) return;

  const { name, description, retrieval_scope } = req.body;
  if (
    retrieval_scope !== undefined &&
    retrieval_scope !== "open" &&
    retrieval_scope !== "restricted"
  ) {
    res.status(400).json({ error: "retrieval_scope must be 'open' or 'restricted'" });
    return;
  }

  const updated = await workspaceRepo.updateWorkspace(getRedis(), req.params.id, {
    name,
    description,
    retrieval_scope,
  });
  res.json(updated);
});

// ============================================
// DELETE /api/workspaces/:id — owner only, not default
// ============================================
workspacesRouter.delete("/workspaces/:id", async (req: Request, res: Response) => {
  const access = await requireAccess(req, res, req.params.id, "owner");
  if (!access) return;
  if (access.workspace.is_default) {
    res.status(400).json({ error: "Cannot delete default workspace" });
    return;
  }
  await workspaceRepo.deleteWorkspace(getRedis(), access.workspace);
  res.json({ success: true });
});

// ============================================
// GET /api/workspaces/:id/knowledge-bases
// ============================================
workspacesRouter.get(
  "/workspaces/:id/knowledge-bases",
  async (req: Request, res: Response) => {
    const redis = getRedis();
    const access = await requireAccess(req, res, req.params.id);
    if (!access) return;

    const filtered = (await kbRepo.getKbsByWorkspace(redis, req.params.id))
      .filter((kb) => !kb.name.startsWith("_"))
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

    if (filtered.length === 0) {
      res.json({ knowledge_bases: [] });
      return;
    }

    // Aggregate active topic_tags per KB for graph edges.
    const out: any[] = [];
    for (const kb of filtered) {
      const tags = new Set<string>();
      let offset = 0;
      for (;;) {
        const { chunks } = await chunkRepo.listChunksByKb(redis, {
          kbId: kb.id,
          offset,
          limit: 200,
          status: "active",
        });
        for (const c of chunks) for (const t of c.topic_tags) tags.add(t);
        if (chunks.length < 200) break;
        offset += 200;
      }
      out.push({ ...kb, topic_tags: Array.from(tags) });
    }

    res.json({ knowledge_bases: out });
  }
);

// ============================================
// POST /api/workspaces/:id/knowledge-bases — create new KB
// ============================================
workspacesRouter.post(
  "/workspaces/:id/knowledge-bases",
  async (req: Request, res: Response) => {
    const access = await requireAccess(req, res, req.params.id, "editor");
    if (!access) return;

    const { name, description, kb_type } = req.body;
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const resolvedType = kb_type ?? "general";
    const kb = await kbRepo.createKb(getRedis(), {
      workspace_id: req.params.id,
      name,
      description: descriptionForNewKb(resolvedType, description),
      kb_type: resolvedType,
    });
    res.status(201).json(kb);
  }
);

// ============================================
// GET /api/workspaces/:id/knowledge-bases/:kbId/chunks
// ============================================
workspacesRouter.get(
  "/workspaces/:id/knowledge-bases/:kbId/chunks",
  async (req: Request, res: Response) => {
    const redis = getRedis();
    const access = await requireAccess(req, res, req.params.id);
    if (!access) return;

    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const limit = Math.min(parseInt((req.query.limit as string) ?? "50", 10), 200);
    const chunkType = req.query.chunk_type as string | undefined;
    const status = (req.query.status as string) ?? "active";
    const search = req.query.search as string | undefined;
    const tags = req.query.topic_tags as string | undefined;

    const { chunks, total } = await chunkRepo.listChunksByKb(redis, {
      kbId: req.params.kbId,
      offset,
      limit,
      status,
      chunkType,
      topicTags: tags ? tags.split(",") : undefined,
      search,
    });

    // Enrich created_by + session.
    const creatorIds = Array.from(
      new Set(chunks.map((c) => c.created_by).filter(Boolean) as string[])
    );
    const creators = await getUsersByIds(redis, creatorIds);
    const sessionCache = new Map<string, any>();
    for (const c of chunks) {
      if (c.session_id && !sessionCache.has(c.session_id)) {
        const s = await sessionRepo.getSession(redis, c.session_id);
        sessionCache.set(c.session_id, s);
      }
    }

    res.json({
      chunks: chunks.map((c) => {
        const creator = c.created_by ? creators.get(c.created_by) : null;
        const session = c.session_id ? sessionCache.get(c.session_id) : null;
        return {
          id: c.id,
          knowledge_base_id: c.knowledge_base_id,
          content: c.content,
          chunk_type: c.chunk_type,
          topic_tags: c.topic_tags,
          related_chunk_ids: c.related_chunk_ids ?? [],
          source_type: c.source_type,
          source_document_id: c.source_document_id,
          status: c.status,
          created_at: c.created_at,
          updated_at: c.updated_at,
          created_by: {
            id: c.created_by,
            name: creator?.name ?? creator?.email ?? null,
          },
          session: session
            ? { tool_used: session.tool_used, summary: session.session_summary }
            : null,
        };
      }),
      total,
      offset,
      limit,
    });
  }
);

// ============================================
// PATCH /api/knowledge-bases/:kbId — edit KB
// ============================================
workspacesRouter.patch("/knowledge-bases/:kbId", async (req: Request, res: Response) => {
  const result = await requireKbAccess(req, res, req.params.kbId, "editor");
  if (!result) return;
  if (rejectIfSystemKb(res, result.kb)) return;

  const { name, description, kb_type, summary } = req.body;
  const updated = await kbRepo.updateKb(getRedis(), req.params.kbId, {
    name,
    description,
    kb_type,
    summary,
  });
  res.json(updated);
});

// ============================================
// POST /api/knowledge-bases/:kbId/move
// ============================================
workspacesRouter.post("/knowledge-bases/:kbId/move", async (req: Request, res: Response) => {
  const redis = getRedis();
  const userId = req.user!.id;
  const { target_workspace_id } = req.body as { target_workspace_id?: string };
  if (!target_workspace_id) {
    res.status(400).json({ error: "target_workspace_id is required" });
    return;
  }

  const source = await requireKbAccess(req, res, req.params.kbId, "editor");
  if (!source) return;
  if (rejectIfSystemKb(res, source.kb)) return;

  if (source.kb.workspace_id === target_workspace_id) {
    res.status(400).json({ error: "Knowledge base is already in the target workspace" });
    return;
  }

  const targetAccess = await getWorkspaceAccess(redis, target_workspace_id, userId);
  if (!targetAccess) {
    res.status(403).json({ error: "No access to the target workspace" });
    return;
  }
  if (!meetsMinimumRole(targetAccess.role, "editor")) {
    res.status(403).json({
      error:
        "You need editor access on the target workspace to move a knowledge base into it.",
      role: targetAccess.role,
    });
    return;
  }

  const moved = await kbRepo.moveKb(
    redis,
    req.params.kbId,
    source.kb.workspace_id,
    target_workspace_id
  );
  res.json(moved);
});

// ============================================
// POST /api/knowledge-bases/:kbId/copy
// ============================================
workspacesRouter.post("/knowledge-bases/:kbId/copy", async (req: Request, res: Response) => {
  const redis = getRedis();
  const userId = req.user!.id;
  const { target_workspace_id } = req.body as { target_workspace_id?: string };
  if (!target_workspace_id) {
    res.status(400).json({ error: "target_workspace_id is required" });
    return;
  }

  const source = await requireKbAccess(req, res, req.params.kbId, "editor");
  if (!source) return;

  const targetAccess = await getWorkspaceAccess(redis, target_workspace_id, userId);
  if (!targetAccess) {
    res.status(403).json({ error: "No access to the target workspace" });
    return;
  }
  if (!meetsMinimumRole(targetAccess.role, "editor")) {
    res.status(403).json({
      error:
        "You need editor access on the target workspace to copy a knowledge base into it.",
      role: targetAccess.role,
    });
    return;
  }

  // Append " (Copy)" if a same-named KB already exists in the target.
  const existing = (await kbRepo.getKbsByWorkspace(redis, target_workspace_id)).find(
    (kb) => kb.name === source.kb.name
  );
  const newName = existing ? `${source.kb.name} (Copy)` : source.kb.name;

  const newKb = await kbRepo.createKb(redis, {
    workspace_id: target_workspace_id,
    name: newName,
    description: source.kb.description,
    kb_type: source.kb.kb_type,
  });

  // Re-embed identical content (Redis returns embeddings as strings, so we
  // regenerate rather than round-trip the binary vector) and bulk insert.
  const rows = await chunkRepo.getActiveChunksForCopy(redis, source.kb.id);
  const now = new Date().toISOString();
  let copied = 0;
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const embeddings = await generateEmbeddings(batch.map((r) => r.content));
    const items = batch.map((r, idx) => ({
      row: {
        knowledge_base_id: newKb.id,
        content: r.content,
        chunk_type: r.chunk_type,
        topic_tags: r.topic_tags,
        related_chunk_ids: [],
        source_type: r.source_type,
        status: "active",
        created_by: userId,
        session_id: null,
        topic_key: null,
        valid_from: now,
      },
      embedding: embeddings[idx],
    }));
    const stored = await chunkRepo.insertChunks(redis, items as any);
    copied += stored.length;
  }

  await kbRepo.setChunkCount(redis, newKb.id, copied);
  res.status(201).json({ ...newKb, chunk_count: copied });
});

// ============================================
// DELETE /api/knowledge-bases/:kbId
// ============================================
workspacesRouter.delete("/knowledge-bases/:kbId", async (req: Request, res: Response) => {
  const result = await requireKbAccess(req, res, req.params.kbId, "editor");
  if (!result) return;
  if (rejectIfSystemKb(res, result.kb)) return;

  try {
    await deleteKnowledgeBase(req.params.kbId, result.kb.workspace_id);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to delete KB" });
    return;
  }

  res.json({ success: true, deleted: { id: result.kb.id, name: result.kb.name } });
});

// ============================================
// PATCH /api/knowledge-bases/:kbId/chunks/:chunkId — edit; re-embed if changed
// ============================================
workspacesRouter.patch(
  "/knowledge-bases/:kbId/chunks/:chunkId",
  async (req: Request, res: Response) => {
    const redis = getRedis();
    const result = await requireKbAccess(req, res, req.params.kbId, "editor");
    if (!result) return;
    if (rejectIfSystemKb(res, result.kb)) return;

    const { content, chunk_type, topic_tags } = req.body;

    const existing = await chunkRepo.getChunkById(redis, req.params.chunkId);
    if (!existing || existing.knowledge_base_id !== req.params.kbId) {
      res.status(404).json({ error: "Chunk not found" });
      return;
    }

    const fields: {
      content?: string;
      chunk_type?: string;
      topic_tags?: string[];
      embedding?: number[];
    } = {};
    if (content !== undefined && content !== existing.content) {
      fields.content = content;
      try {
        fields.embedding = await generateEmbedding(content);
      } catch (err: any) {
        res.status(500).json({ error: `Embedding failed: ${err.message}` });
        return;
      }
    }
    if (chunk_type !== undefined) fields.chunk_type = chunk_type;
    if (topic_tags !== undefined) fields.topic_tags = topic_tags;

    const updated = await chunkRepo.updateChunk(redis, req.params.chunkId, fields);
    res.json(updated);
  }
);

// ============================================
// DELETE /api/knowledge-bases/:kbId/chunks/:chunkId — soft archive
// ============================================
workspacesRouter.delete(
  "/knowledge-bases/:kbId/chunks/:chunkId",
  async (req: Request, res: Response) => {
    const redis = getRedis();
    const result = await requireKbAccess(req, res, req.params.kbId, "editor");
    if (!result) return;
    if (rejectIfSystemKb(res, result.kb)) return;

    const ok = await chunkRepo.archiveChunk(redis, req.params.kbId, req.params.chunkId);
    if (!ok) {
      res.status(404).json({ error: "Chunk not found" });
      return;
    }

    const count = await chunkRepo.countActive(redis, [req.params.kbId]);
    await kbRepo.setChunkCount(redis, req.params.kbId, count);
    res.json({ success: true });
  }
);

// ============================================
// GET /api/workspaces/:id/history — sessions for workspace KBs
// ============================================
workspacesRouter.get("/workspaces/:id/history", async (req: Request, res: Response) => {
  const redis = getRedis();
  const access = await requireAccess(req, res, req.params.id);
  if (!access) return;

  const kbs = await kbRepo.getKbsByWorkspace(redis, req.params.id);
  const kbIds = kbs.map((kb) => kb.id);
  if (kbIds.length === 0) {
    res.json({ sessions: [] });
    return;
  }

  const userFilter = req.query.user_id as string | undefined;
  const kbFilter = req.query.knowledge_base_id as string | undefined;
  const limit = Math.min(parseInt((req.query.limit as string) ?? "50", 10), 200);

  const scopeKbIds = kbFilter ? [kbFilter] : kbIds;
  let sessions = await sessionRepo.getSessionsByKbs(redis, scopeKbIds, limit);
  if (userFilter) sessions = sessions.filter((s) => s.user_id === userFilter);

  const userIds = Array.from(new Set(sessions.map((s) => s.user_id)));
  const users = await getUsersByIds(redis, userIds);
  const kbNameMap = new Map(kbs.map((kb) => [kb.id, kb.name]));

  const out: any[] = [];
  for (const s of sessions) {
    const u = users.get(s.user_id);
    const jobId = await sessionRepo.getSessionJobId(redis, s.id);
    out.push({
      id: s.id,
      user: {
        id: s.user_id,
        name: u?.name ?? u?.email ?? "Unknown",
        email: u?.email,
      },
      tool_used: s.tool_used,
      timestamp: s.created_at,
      summary: s.session_summary,
      chunks_added: s.chunks_added,
      chunks_superseded: s.chunks_superseded,
      knowledge_bases: (s.knowledge_bases_used ?? []).map((id: string) => ({
        id,
        name: kbNameMap.get(id) ?? "Unknown",
      })),
      conversation_text_available:
        typeof s.conversation_text === "string" && s.conversation_text.length > 0,
      job_id: jobId,
    });
  }

  res.json({ sessions: out });
});

// ============================================
// GET /api/workspaces/:id/team
// ============================================
workspacesRouter.get("/workspaces/:id/team", async (req: Request, res: Response) => {
  const redis = getRedis();
  const access = await requireAccess(req, res, req.params.id);
  if (!access) return;

  const memberEntries = await workspaceRepo.getWorkspaceMembers(redis, req.params.id);
  const invites = await inviteRepo.listActiveInvites(redis, req.params.id);

  const memberUserIds = new Set(memberEntries.map((m) => m.user_id));
  const users = await getUsersByIds(redis, [
    ...memberUserIds,
    access.workspace.owner_id,
  ]);

  let ownerEntry: any = null;
  if (!memberUserIds.has(access.workspace.owner_id)) {
    const ownerUser = users.get(access.workspace.owner_id);
    if (ownerUser) {
      ownerEntry = {
        user_id: access.workspace.owner_id,
        role: "owner",
        name: ownerUser.name ?? ownerUser.email,
        email: ownerUser.email,
        joined_at: ownerUser.created_at ?? null,
      };
    }
  }

  const memberList = memberEntries.map((m) => {
    const u = users.get(m.user_id);
    return {
      user_id: m.user_id,
      role: m.role,
      name: u?.name ?? u?.email ?? "Member",
      email: u?.email,
      joined_at: u?.created_at ?? null,
    };
  });

  res.json({
    members: ownerEntry ? [ownerEntry, ...memberList] : memberList,
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      token: i.token,
      expires_at: i.expires_at,
      created_at: i.created_at,
    })),
  });
});

// ============================================
// POST /api/workspaces/:id/invites
// ============================================
workspacesRouter.post("/workspaces/:id/invites", async (req: Request, res: Response) => {
  const redis = getRedis();
  const access = await requireAccess(req, res, req.params.id, "owner");
  if (!access) return;

  const { email, role } = req.body;
  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  const inviteRole = role ?? "editor";
  const invite = await inviteRepo.createInvite(redis, {
    workspace_id: req.params.id,
    email,
    invited_by: req.user!.id,
    role: inviteRole,
  });

  const inviterName = req.user!.name ?? req.user!.email;
  const workspaceName = access.workspace.name ?? "a workspace";
  const inviteLink = `${APP_BASE_URL}/invite/${invite.token}`;
  void sendInviteEmail({
    to: email,
    inviterName,
    workspaceName,
    inviteLink,
    role: inviteRole,
  }).then((result) => {
    if (result.ok) {
      notify({
        type: "invite_sent",
        title: `Invite sent to ${email} for ${workspaceName}`,
        workspaceId: req.params.id,
        actorId: req.user!.id,
        recipientIds: [req.user!.id],
      });
    }
  });

  track(req.user!.id, "team.invite_sent", { workspace_id: req.params.id });

  res.status(201).json(invite);
});

// ============================================
// DELETE /api/workspaces/:id/invites/:inviteId
// ============================================
workspacesRouter.delete(
  "/workspaces/:id/invites/:inviteId",
  async (req: Request, res: Response) => {
    const access = await requireAccess(req, res, req.params.id, "owner");
    if (!access) return;
    await inviteRepo.deleteInviteById(getRedis(), req.params.id, req.params.inviteId);
    res.json({ success: true });
  }
);

// ============================================
// PATCH /api/workspaces/:id/members/:userId — change a member's role
// ============================================
workspacesRouter.patch(
  "/workspaces/:id/members/:userId",
  async (req: Request, res: Response) => {
    const redis = getRedis();
    const access = await requireAccess(req, res, req.params.id, "owner");
    if (!access) return;

    const { role } = req.body as { role?: string };
    if (!role || !["owner", "editor", "viewer"].includes(role)) {
      res.status(400).json({ error: "role must be one of: owner, editor, viewer" });
      return;
    }
    if (req.params.userId === access.workspace.owner_id) {
      res.status(400).json({ error: "Cannot change the role of the workspace owner" });
      return;
    }

    const existing = await workspaceRepo.getWorkspaceMemberRole(
      redis,
      req.params.id,
      req.params.userId
    );
    if (!existing) {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    await workspaceRepo.addWorkspaceMember(redis, req.params.id, req.params.userId, role);
    res.json({ user_id: req.params.userId, role });
  }
);

// ============================================
// DELETE /api/workspaces/:id/members/:userId — remove a member
// ============================================
workspacesRouter.delete(
  "/workspaces/:id/members/:userId",
  async (req: Request, res: Response) => {
    const access = await requireAccess(req, res, req.params.id, "owner");
    if (!access) return;
    if (req.params.userId === access.workspace.owner_id) {
      res.status(400).json({ error: "Cannot remove the workspace owner" });
      return;
    }
    await workspaceRepo.removeWorkspaceMember(getRedis(), req.params.id, req.params.userId);
    res.json({ success: true });
  }
);

// ============================================
// POST /api/invites/:token/accept
// ============================================
workspacesRouter.post("/invites/:token/accept", async (req: Request, res: Response) => {
  const redis = getRedis();
  const invite = await inviteRepo.getInviteByToken(redis, req.params.token);

  if (!invite) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }
  if (invite.accepted_at) {
    res.status(400).json({ error: "Invite already accepted" });
    return;
  }
  if (new Date(invite.expires_at) < new Date()) {
    res.status(400).json({ error: "Invite expired" });
    return;
  }

  await workspaceRepo.addWorkspaceMember(redis, invite.workspace_id, req.user!.id, invite.role);
  await inviteRepo.markInviteAccepted(redis, req.params.token);

  const ws = await workspaceRepo.getWorkspace(redis, invite.workspace_id);
  const actorName = req.user!.name ?? req.user!.email;
  notify({
    type: "member_joined",
    title: `${actorName} joined ${ws?.name ?? "the workspace"}`,
    workspaceId: invite.workspace_id,
    actorId: req.user!.id,
  });

  track(req.user!.id, "team.invite_accepted", { workspace_id: invite.workspace_id });

  res.json({ workspace_id: invite.workspace_id });
});

// Public invite preview — mounted on publicInvitesRouter (no auth).
publicInvitesRouter.get("/invites/:token/preview", async (req: Request, res: Response) => {
  const redis = getRedis();
  const invite = await inviteRepo.getInviteByToken(redis, req.params.token);
  if (!invite) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }
  const workspace = await workspaceRepo.getWorkspace(redis, invite.workspace_id);
  res.json({
    email: invite.email,
    role: invite.role,
    expires_at: invite.expires_at,
    accepted: !!invite.accepted_at,
    expired: new Date(invite.expires_at) < new Date(),
    workspace: workspace
      ? { name: workspace.name, description: workspace.description }
      : null,
  });
});

// ============================================
// POST /api/workspaces/:id/documents — upload + process
// ============================================
workspacesRouter.post(
  "/workspaces/:id/documents",
  upload.single("file"),
  async (req: Request, res: Response) => {
    const redis = getRedis();
    const access = await requireAccess(req, res, req.params.id, "editor");
    if (!access) return;

    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const knowledgeBaseId = req.body.knowledge_base_id as string | undefined;
    if (!knowledgeBaseId) {
      res.status(400).json({ error: "knowledge_base_id is required" });
      return;
    }

    const kb = await kbRepo.getKb(redis, knowledgeBaseId);
    if (!kb || kb.workspace_id !== req.params.id) {
      res.status(404).json({ error: "Knowledge base not in this workspace" });
      return;
    }

    const fileExt = req.file.originalname.split(".").pop()?.toLowerCase() ?? "";
    const allowed = ["pdf", "docx", "txt", "md", "csv"];
    if (!allowed.includes(fileExt)) {
      res.status(400).json({ error: `Unsupported file type. Allowed: ${allowed.join(", ")}` });
      return;
    }

    const documentId = randomBytes(16).toString("hex");
    const storagePath = await docRepo.writeDocumentBytes(
      req.params.id,
      documentId,
      req.file.originalname,
      req.file.buffer
    );

    await docRepo.createDocument(redis, {
      id: documentId,
      knowledge_base_id: knowledgeBaseId,
      file_name: req.file.originalname,
      file_type: fileExt,
      file_size: req.file.size,
      storage_path: storagePath,
      uploaded_by: req.user!.id,
      processing_status: "processing",
    });

    try {
      await processDocument(documentId, req.file.buffer, fileExt, req.user!.id);
    } catch (err: any) {
      console.error("[document] processing error:", err.message);
    }

    const finalDoc = await docRepo.getDocument(redis, documentId);

    const actorName = req.user!.name ?? req.user!.email;
    notify({
      type: "document_upload",
      title: `${actorName} uploaded ${req.file.originalname} to ${kb.name ?? "a knowledge base"}`,
      workspaceId: req.params.id,
      actorId: req.user!.id,
    });

    track(req.user!.id, "document.uploaded", {
      file_type: req.file.mimetype || "unknown",
      workspace_id: req.params.id,
    });

    res.status(201).json(finalDoc);
  }
);

// ============================================
// GET /api/workspaces/:id/documents
// ============================================
workspacesRouter.get("/workspaces/:id/documents", async (req: Request, res: Response) => {
  const redis = getRedis();
  const access = await requireAccess(req, res, req.params.id);
  if (!access) return;

  const kbs = await kbRepo.getKbsByWorkspace(redis, req.params.id);
  if (kbs.length === 0) {
    res.json({ documents: [] });
    return;
  }
  const kbNameMap = new Map(kbs.map((kb) => [kb.id, kb.name]));

  const docs: any[] = [];
  for (const kb of kbs) {
    const list = await docRepo.listDocumentsByKb(redis, kb.id);
    for (const d of list) {
      docs.push({ ...d, knowledge_base_name: kbNameMap.get(d.knowledge_base_id) ?? "Unknown" });
    }
  }
  docs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  res.json({ documents: docs });
});

// ============================================
// DELETE /api/documents/:docId
// ============================================
workspacesRouter.delete("/documents/:docId", async (req: Request, res: Response) => {
  const redis = getRedis();
  const doc = await docRepo.getDocument(redis, req.params.docId);
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const kb = await kbRepo.getKb(redis, doc.knowledge_base_id);
  const wsId = kb?.workspace_id;
  if (wsId) {
    const access = await getWorkspaceAccess(redis, wsId, req.user!.id);
    if (!access) {
      res.status(403).json({ error: "No access" });
      return;
    }
    if (!meetsMinimumRole(access.role, "editor")) {
      res.status(403).json({
        error:
          "You have view-only access to this workspace. Ask the workspace owner to upgrade your role to editor.",
        role: access.role,
      });
      return;
    }
  }

  await chunkRepo.deleteChunksByDocument(redis, doc.knowledge_base_id, doc.id);
  await docRepo.deleteDocument(redis, doc);

  const count = await chunkRepo.countActive(redis, [doc.knowledge_base_id]);
  await kbRepo.setChunkCount(redis, doc.knowledge_base_id, count);

  res.json({ success: true });
});

// ============================================
// GET /api/documents/:docId/chunks
// ============================================
workspacesRouter.get("/documents/:docId/chunks", async (req: Request, res: Response) => {
  const redis = getRedis();
  const doc = await docRepo.getDocument(redis, req.params.docId);
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const kb = await kbRepo.getKb(redis, doc.knowledge_base_id);
  const wsId = kb?.workspace_id;
  if (wsId) {
    const access = await getWorkspaceAccess(redis, wsId, req.user!.id);
    if (!access) {
      res.status(403).json({ error: "No access" });
      return;
    }
  }

  const chunks = await chunkRepo.getActiveChunksByDocument(redis, req.params.docId);
  res.json({ chunks });
});

// ============================================
// Processing jobs (server-side extraction)
// ============================================

async function requireJobAccess(
  req: Request,
  res: Response,
  jobId: string,
  minRole: WorkspaceRole = "viewer"
): Promise<{ job: JobDetail; workspaceId: string } | null> {
  const redis = getRedis();
  const job = await getJobDetail(jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found", job_id: jobId });
    return null;
  }
  const kb = await kbRepo.getKb(redis, job.knowledge_base_id);
  if (!kb) {
    res.status(404).json({ error: "Knowledge base for this job no longer exists" });
    return null;
  }
  const access = await getWorkspaceAccess(redis, kb.workspace_id, req.user!.id);
  if (!access) {
    res.status(403).json({ error: "No access to this job's workspace" });
    return null;
  }
  if (!meetsMinimumRole(access.role, minRole)) {
    res.status(403).json({
      error:
        minRole === "editor"
          ? "You have view-only access to this workspace. Ask the workspace owner to upgrade your role to editor."
          : "Owner access required for this action.",
      role: access.role,
    });
    return null;
  }
  return { job, workspaceId: kb.workspace_id };
}

// GET /api/workspaces/:id/jobs
workspacesRouter.get("/workspaces/:id/jobs", async (req: Request, res: Response) => {
  const redis = getRedis();
  const access = await requireAccess(req, res, req.params.id);
  if (!access) return;

  const status = req.query.status as string | undefined;
  const limit = Math.min(parseInt((req.query.limit as string) ?? "20", 10), 100);
  const offset = Math.max(parseInt((req.query.offset as string) ?? "0", 10), 0);

  const kbs = await kbRepo.getKbsByWorkspace(redis, req.params.id);
  const kbIds = kbs.map((kb) => kb.id);
  if (kbIds.length === 0) {
    res.json({ jobs: [], total: 0 });
    return;
  }
  const kbNameMap = new Map(kbs.map((kb) => [kb.id, kb.name]));

  const { jobs, total } = await listJobsByKbs(kbIds, { status, limit, offset });
  res.json({
    jobs: jobs.map((j) => ({
      id: j.id,
      knowledge_base_id: j.knowledge_base_id,
      status: j.status,
      tool_used: j.tool_used,
      chunks_created: j.chunks_created,
      chunks_deduplicated: j.chunks_deduplicated,
      chunks_superseded: j.chunks_superseded,
      extraction_model: j.extraction_model,
      extraction_ms: j.extraction_ms,
      pipeline_ms: j.pipeline_ms,
      error_message: j.error_message,
      created_at: j.created_at,
      started_at: j.started_at,
      completed_at: j.completed_at,
      knowledge_base_name: kbNameMap.get(j.knowledge_base_id) ?? null,
    })),
    total,
  });
});

// GET /api/jobs/:id
workspacesRouter.get("/jobs/:id", async (req: Request, res: Response) => {
  const result = await requireJobAccess(req, res, req.params.id);
  if (!result) return;
  const { job } = result;
  const kb = await kbRepo.getKb(getRedis(), job.knowledge_base_id);
  res.json({ ...job, knowledge_base_name: kb?.name ?? null });
});

// POST /api/jobs/:id/re-extract
workspacesRouter.post("/jobs/:id/re-extract", async (req: Request, res: Response) => {
  const result = await requireJobAccess(req, res, req.params.id, "editor");
  if (!result) return;
  const { job } = result;

  if (!job.conversation_text || job.conversation_text.length === 0) {
    res.status(400).json({
      error: "This job has no stored conversation_text — re-extract is not available.",
    });
    return;
  }

  try {
    const { jobId } = await enqueueJob({
      userId: req.user!.id,
      knowledgeBaseId: job.knowledge_base_id,
      conversationText: job.conversation_text,
      toolUsed: job.tool_used ?? undefined,
    });
    track(req.user!.id, "mcp.save_session", {
      kb_id: job.knowledge_base_id,
      re_extract: true,
      source_job_id: job.id,
    });
    res.status(202).json({
      job_id: jobId,
      status: "queued",
      message:
        "Re-extraction queued. The new chunks will dedup against existing KB content.",
    });
  } catch (err: any) {
    console.error("[jobs:re-extract] enqueue failed:", err?.message ?? err);
    res.status(500).json({ error: "Failed to enqueue re-extraction" });
  }
});
