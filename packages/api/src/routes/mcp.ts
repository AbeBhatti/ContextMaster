import { Router, type Request, type Response } from "express";
import { getRedis } from "../lib/redis.js";
import { storeChunks, storeChunksRaw } from "../services/chunkService.js";
import {
  extractEntities,
  checkCoverage,
  generateSupplementaryChunks,
} from "../services/entityExtractor.js";
import { recall } from "../services/recallService.js";
import { getWorkspaceAccess, meetsMinimumRole } from "../lib/access.js";
import { descriptionForNewKb } from "../lib/kbTemplates.js";
import { track, recordMcpUsage } from "../lib/analytics.js";
import {
  enqueueJob,
  getJobStatus,
  countRecentJobs,
  oldestJobInWindow,
} from "../services/jobService.js";
import * as kbRepo from "../lib/kbRepo.js";
import * as chunkRepo from "../lib/chunkRepo.js";
import * as workspaceRepo from "../lib/workspaceRepo.js";
import * as sessionRepo from "../lib/sessionRepo.js";
import type { CommitRequest, RecallRequest } from "../lib/types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Server-side extraction is gpt-4o-mini-backed and costs real money per
// request. Cap each user at 20 jobs per rolling hour. Mirrors the reference.
const COMMIT_RAW_RATE_LIMIT_PER_HOUR = 20;
const ONE_HOUR_MS = 60 * 60 * 1000;

const VIEWER_ONLY_MESSAGE =
  "You have view-only access to this workspace. Ask the workspace owner to upgrade your role to editor.";

export const mcpRouter = Router();

// ============================================
// GET /mcp/context — check_memory
// ============================================
mcpRouter.get("/context", async (req: Request, res: Response) => {
  try {
    const redis = getRedis();
    const userId = req.user!.id;
    console.log(`[mcp] check_memory  user=${userId}`);

    const allWorkspaces = await workspaceRepo.listUserWorkspaces(redis, userId);
    const workspaceIds = allWorkspaces.map((w) => w.id);

    // KBs whose name starts with `_` are hidden (eval/infra corpora).
    const allKbs = (await kbRepo.getKbsByWorkspaces(redis, workspaceIds)).filter(
      (kb) => !kb.name.startsWith("_")
    );

    const kbsByWorkspace = new Map<string, any[]>();
    for (const kb of allKbs) {
      const list = kbsByWorkspace.get(kb.workspace_id) ?? [];
      list.push({
        id: kb.id,
        name: kb.name,
        type: kb.kb_type,
        description: kb.description,
        summary: kb.summary,
        last_session_summary: kb.last_session_summary,
        last_updated: kb.updated_at,
        chunk_count: kb.chunk_count,
      });
      kbsByWorkspace.set(kb.workspace_id, list);
    }
    for (const list of kbsByWorkspace.values()) {
      list.sort(
        (a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()
      );
    }

    const workspaces = [];
    for (const ws of allWorkspaces) {
      workspaces.push({
        id: ws.id,
        name: ws.name,
        is_default: ws.is_default,
        retrieval_scope: await workspaceRepo.getRetrievalScope(redis, ws.id),
        knowledge_bases: kbsByWorkspace.get(ws.id) ?? [],
      });
    }
    workspaces.sort((a, b) => {
      if (a.is_default && !b.is_default) return -1;
      if (!a.is_default && b.is_default) return 1;
      return 0;
    });

    // most_recent_kb: latest session's first KB if non-empty, else the
    // most-recently-updated non-empty KB.
    let mostRecentKb: any = null;
    const latestSession = await sessionRepo.getLatestSession(redis, userId);
    const allKbsFlat = allKbs.filter((kb) => kb.chunk_count > 0);
    const kbById = new Map(allKbsFlat.map((kb) => [kb.id, kb]));

    if (latestSession && latestSession.knowledge_bases_used.length > 0) {
      const kb = kbById.get(latestSession.knowledge_bases_used[0]);
      if (kb) {
        mostRecentKb = {
          id: kb.id,
          name: kb.name,
          type: kb.kb_type,
          description: kb.description,
          last_session_summary: kb.last_session_summary,
          last_updated: kb.updated_at,
          session_at: latestSession.created_at,
          chunk_count: kb.chunk_count,
        };
      }
    }
    if (!mostRecentKb && allKbsFlat.length > 0) {
      const sorted = [...allKbsFlat].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      const kb = sorted[0];
      mostRecentKb = {
        id: kb.id,
        name: kb.name,
        type: kb.kb_type,
        description: kb.description,
        last_session_summary: kb.last_session_summary,
        last_updated: kb.updated_at,
        session_at: null,
        chunk_count: kb.chunk_count,
      };
    }

    track(userId, "mcp.check_memory", {
      kb_count: allKbs.length,
      workspace_count: workspaces.length,
    });
    recordMcpUsage(userId, "mcp.check_memory");

    res.json({
      most_recent_kb: mostRecentKb,
      workspaces,
      // Org-shared KBs land in phase 6.
      shared_knowledge_bases: [],
      tip: "Use save_session to preserve this conversation's knowledge. It processes in the background — you'll get a response instantly.",
    });
  } catch (err: any) {
    console.error("[check_memory] Error:", err.message);
    res.status(500).json({ error: "Failed to retrieve context" });
  }
});

// ============================================
// POST /mcp/recall — search_memory
// ============================================
mcpRouter.post("/recall", async (req: Request, res: Response) => {
  try {
    const redis = getRedis();
    const body = req.body as RecallRequest;
    const userId = req.user!.id;
    console.log(
      `[mcp] search_memory user=${userId}  q="${(body.query ?? "").slice(0, 60)}"  kbs=${
        body.knowledge_base_ids?.length ?? 0
      }  kb_name=${body.knowledge_base ?? ""}  ws_name=${body.workspace ?? ""}`
    );

    if (!body.query) {
      res.status(400).json({ error: "query is required" });
      return;
    }

    // Resolve KB IDs. Priority: ids > kb name > workspace name > default.
    let kbIds: string[] | undefined;
    const userWsIds = await workspaceRepo.getUserWorkspaceIds(redis, userId);

    if (body.knowledge_base_ids && body.knowledge_base_ids.length > 0) {
      kbIds = body.knowledge_base_ids;
    } else if (body.knowledge_base) {
      const needle = body.knowledge_base.toLowerCase();
      const kbs = await kbRepo.getKbsByWorkspaces(redis, userWsIds);
      kbIds = kbs.filter((kb) => kb.name.toLowerCase().includes(needle)).map((kb) => kb.id);
    } else if (body.workspace) {
      const needle = body.workspace.toLowerCase();
      const wsList = await workspaceRepo.listUserWorkspaces(redis, userId);
      const ws = wsList.find((w) => w.name.toLowerCase().includes(needle));
      if (ws) {
        kbIds = (await kbRepo.getKbsByWorkspace(redis, ws.id)).map((kb) => kb.id);
      }
    }

    // Semantic KB routing (when nothing resolved) lands in phase 5; until then
    // recall() falls back to all of the user's open-scope KBs.
    const result = await recall({
      query: body.query,
      knowledgeBaseIds: kbIds,
      maxResults: body.max_results,
      chunkTypes: body.chunk_types,
      userId,
    });

    track(userId, "mcp.search_memory", {
      result_count: result.chunks?.length ?? 0,
      query_length: body.query?.length || 0,
      has_kb_filter: !!(body.knowledge_base_ids?.length || body.knowledge_base),
      has_chunk_type_filter: !!body.chunk_types?.length,
    });
    recordMcpUsage(userId, "mcp.search_memory");

    res.json(result);
  } catch (err: any) {
    console.error("[search_memory] Error:", err.message);
    res.status(500).json({ error: "Recall search failed" });
  }
});

// ============================================
// POST /mcp/commit — save_memory
// ============================================
mcpRouter.post("/commit", async (req: Request, res: Response) => {
  try {
    const redis = getRedis();
    const userId = req.user!.id;
    const body = req.body as CommitRequest;
    console.log(
      `[mcp] save_memory user=${userId}  chunks=${body.chunks?.length ?? 0}  kb=${
        body.knowledge_base_id ?? "(new)"
      }  tool=${body.tool_used ?? "?"}`
    );

    if (!body.chunks?.length) {
      res.status(400).json({ error: "At least one chunk is required" });
      return;
    }

    let knowledgeBaseId = body.knowledge_base_id;
    let targetWorkspaceId: string | null = null;

    // Create a new KB if requested.
    if (!knowledgeBaseId && body.new_knowledge_base) {
      const newKb = body.new_knowledge_base;
      let workspaceId: string | null = newKb.workspace_id ?? null;
      if (!workspaceId) {
        const defaultWs = await workspaceRepo.getDefaultWorkspace(redis, userId);
        if (!defaultWs) {
          res.status(400).json({ error: "No default workspace found. Create a workspace first." });
          return;
        }
        workspaceId = defaultWs.id;
      }

      const access = await getWorkspaceAccess(redis, workspaceId, userId);
      if (!access) {
        res.status(403).json({ error: "No access to the target workspace" });
        return;
      }
      if (!meetsMinimumRole(access.role, "editor")) {
        res.status(403).json({ error: VIEWER_ONLY_MESSAGE, role: access.role });
        return;
      }

      const kbType = newKb.kb_type || "general";
      const createdKb = await kbRepo.createKb(redis, {
        workspace_id: workspaceId,
        name: newKb.name,
        description: descriptionForNewKb(kbType, newKb.description),
        kb_type: kbType,
      });
      knowledgeBaseId = createdKb.id;
      targetWorkspaceId = workspaceId;
    }

    if (!knowledgeBaseId) {
      res.status(400).json({ error: "Either knowledge_base_id or new_knowledge_base is required" });
      return;
    }

    // Validate existing KB + enforce editor+ before any expensive work.
    if (!targetWorkspaceId) {
      const kb = await kbRepo.getKb(redis, knowledgeBaseId);
      if (!kb) {
        res.status(404).json({ error: "Knowledge base not found", kb_id: knowledgeBaseId });
        return;
      }
      targetWorkspaceId = kb.workspace_id;
      const access = await getWorkspaceAccess(redis, targetWorkspaceId, userId);
      if (!access) {
        res.status(403).json({ error: "No access to this knowledge base's workspace" });
        return;
      }
      if (!meetsMinimumRole(access.role, "editor")) {
        res.status(403).json({ error: VIEWER_ONLY_MESSAGE, role: access.role });
        return;
      }
    }

    // Create the session row.
    const session = await sessionRepo.createSession(redis, {
      user_id: userId,
      tool_used: body.tool_used ?? null,
      knowledge_bases_used: [knowledgeBaseId],
      session_summary: body.session_summary,
    });

    // Human-readable date prefix → embeds temporal signal into the content.
    const sessionDate = session.created_at ?? new Date().toISOString();
    const datePrefix = `[${new Date(sessionDate).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })}] `;

    // Promote next_steps / open_questions into searchable continuity chunks.
    const continuityChunks: CommitRequest["chunks"] = [];
    const continuityTagsToSupersede: string[] = [];
    if (body.next_steps && body.next_steps.trim()) {
      continuityChunks.push({
        content: `Next steps: ${body.next_steps.trim()}`,
        chunk_type: "state",
        topic_tags: ["next-steps", "continuity"],
        label: "next-steps",
      });
      continuityTagsToSupersede.push("next-steps");
    }
    if (body.open_questions && body.open_questions.trim()) {
      continuityChunks.push({
        content: `Open questions: ${body.open_questions.trim()}`,
        chunk_type: "state",
        topic_tags: ["open-questions", "continuity"],
        label: "open-questions",
      });
      continuityTagsToSupersede.push("open-questions");
    }

    if (continuityTagsToSupersede.length > 0) {
      await chunkRepo.supersedeContinuityChunks(
        redis,
        knowledgeBaseId,
        continuityTagsToSupersede,
        sessionDate
      );
    }

    const allInputChunks = [...body.chunks, ...continuityChunks];
    const datedChunks = allInputChunks.map((c) => ({ ...c, content: datePrefix + c.content }));

    const result = await storeChunks(knowledgeBaseId, datedChunks, userId, session.id, sessionDate);

    // Resolve related_to_labels → real UUIDs and merge into related_chunk_ids.
    const labelToId = new Map<string, string>();
    for (const entry of result.chunkMap) {
      const inputChunk = allInputChunks[entry.index];
      if (inputChunk.label) labelToId.set(inputChunk.label, entry.id);
    }
    if (labelToId.size > 0) {
      const updates: Promise<unknown>[] = [];
      for (const entry of result.chunkMap) {
        const inputChunk = allInputChunks[entry.index];
        const labels = inputChunk.related_to_labels;
        if (!labels?.length) continue;
        const resolved: string[] = [];
        for (const label of labels) {
          const id = labelToId.get(label);
          if (id && id !== entry.id) resolved.push(id);
        }
        if (resolved.length === 0) continue;
        const existing = inputChunk.related_to ?? [];
        const merged = Array.from(new Set([...existing, ...resolved]));
        updates.push(chunkRepo.updateRelatedChunkIds(redis, entry.id, merged));
      }
      if (updates.length > 0) await Promise.all(updates);
    }

    await sessionRepo.updateSessionCounts(redis, session.id, {
      chunks_added: result.stored,
      chunks_superseded: result.superseded,
    });

    // Update KB last_session_summary (+ optional description).
    const lastSessionSummary = [
      body.session_summary,
      body.next_steps ? `Next: ${body.next_steps}` : null,
      body.open_questions ? `Open: ${body.open_questions}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    await kbRepo.updateKb(redis, knowledgeBaseId, {
      last_session_summary: lastSessionSummary,
      ...(body.kb_description_update ? { description: body.kb_description_update } : {}),
    });

    const updatedKb = await kbRepo.getKb(redis, knowledgeBaseId);

    track(userId, "mcp.save_memory", {
      chunk_count: body.chunks.length,
      kb_id: knowledgeBaseId,
      kb_name: updatedKb?.name ?? null,
      tool_used: body.tool_used ?? null,
      is_new_kb: !!body.new_knowledge_base,
    });
    recordMcpUsage(userId, "mcp.save_memory");

    // Super commit (LLM verification) lands in phase 6; report it as skipped
    // so the response shape stays stable for enhanced callers.
    const wantsEnhanced = body.enhanced === true;
    const willRunCoverage =
      !body.skip_coverage_verification &&
      !!body.session_summary &&
      body.session_summary.trim().length > 0;

    res.json({
      success: true,
      chunks_stored: result.stored,
      chunks_deduplicated: result.deduplicated,
      chunks_superseded: result.superseded,
      coverage_gaps_detected: 0,
      supplementary_chunks: 0,
      coverage_verification: willRunCoverage ? "processing" : "skipped",
      knowledge_base: updatedKb ? { id: updatedKb.id, name: updatedKb.name, chunk_count: updatedKb.chunk_count } : null,
      ...(wantsEnhanced ? { super_commit: false, super_commit_status: "skipped" } : {}),
    });

    // ---- Background: entity coverage verification (regex NER) ----
    if (willRunCoverage) {
      void (async () => {
        try {
          const summaryEntities = extractEntities(body.session_summary);
          const gaps = checkCoverage(
            summaryEntities,
            datedChunks.map((c) => ({ content: c.content }))
          );
          if (gaps.length === 0) return;
          const supplementary = generateSupplementaryChunks(gaps, datePrefix);
          if (supplementary.length === 0) return;
          const rawResult = await storeChunksRaw(
            knowledgeBaseId!,
            supplementary.map((s) => ({
              content: s.content,
              chunk_type: s.chunk_type,
              topic_tags: s.topic_tags,
              source_type: "coverage_verification",
            })),
            userId,
            session.id,
            sessionDate
          );
          if (rawResult.stored > 0) {
            await sessionRepo.updateSessionCounts(redis, session.id, {
              chunks_added: result.stored + rawResult.stored,
            });
          }
          console.log(
            `[coverage:background] ${gaps.length} gap(s) across ${supplementary.length} sentence(s) → ${rawResult.stored} supplementary chunks (kb=${knowledgeBaseId})`
          );
        } catch (err: any) {
          console.error("[coverage:background]", err?.message ?? String(err));
        }
      })();
    }

    // ---- Background: store the session_summary as a searchable chunk ----
    if (body.session_summary && body.session_summary.trim().length > 100) {
      void (async () => {
        try {
          await storeChunksRaw(
            knowledgeBaseId!,
            [
              {
                content: datePrefix + body.session_summary!,
                chunk_type: "session_summary",
                topic_tags: ["session-summary", "overview"],
                source_type: "session",
              },
            ],
            userId,
            session.id,
            sessionDate
          );
        } catch (err: any) {
          console.error("[session-summary:background]", err?.message ?? String(err));
        }
      })();
    }
  } catch (err: any) {
    console.error("[save_memory] Error:", err.message);
    res.status(500).json({ error: "Failed to commit knowledge" });
  }
});

// ============================================
// GET /mcp/history — check_updates
// ============================================
mcpRouter.get("/history", async (req: Request, res: Response) => {
  try {
    const redis = getRedis();
    const userId = req.user!.id;
    const since = req.query.since as string | undefined;
    console.log(`[mcp] check_updates user=${userId}  since=${since ?? "(default)"}`);
    const kbIdsParam = req.query.knowledge_base_ids as string | undefined;

    let sinceMs: number;
    if (since) {
      const parsed = new Date(since).getTime();
      sinceMs = Number.isNaN(parsed) ? Date.now() - 7 * 24 * ONE_HOUR_MS : parsed;
    } else {
      const lastSession = await sessionRepo.getLatestSession(redis, userId);
      sinceMs = lastSession
        ? new Date(lastSession.created_at).getTime()
        : Date.now() - 7 * 24 * ONE_HOUR_MS;
    }
    const sinceDate = new Date(sinceMs).toISOString();

    const sessions = await sessionRepo.getSessionsSince(redis, userId, sinceMs, 20);
    const kbFilter = kbIdsParam ? kbIdsParam.split(",").filter(Boolean) : undefined;

    const newChunks = await chunkRepo.getChunksCreatedSince(redis, sinceMs, kbFilter, 50);
    const supersededChunks = await chunkRepo.getChunksSupersededSince(redis, sinceMs, 20);

    const allKbIds = new Set<string>();
    newChunks.forEach((c) => allKbIds.add(c.knowledge_base_id));
    supersededChunks.forEach((c) => allKbIds.add(c.knowledge_base_id));
    const kbNameMap = await kbRepo.getKbNames(redis, Array.from(allKbIds));

    const userName = req.user!.name ?? req.user!.email ?? "Unknown";

    track(userId, "mcp.check_updates", { has_since_filter: !!since });
    recordMcpUsage(userId, "mcp.check_updates");

    res.json({
      changes_since: sinceDate,
      sessions: sessions.map((s) => ({
        user_name: userName,
        tool_used: s.tool_used,
        timestamp: s.created_at,
        summary: s.session_summary,
        chunks_added: s.chunks_added,
        chunks_superseded: s.chunks_superseded,
      })),
      new_chunks: newChunks.map((c) => ({
        id: c.id,
        content: c.content,
        chunk_type: c.chunk_type,
        knowledge_base: kbNameMap.get(c.knowledge_base_id) ?? "Unknown",
        created_at: c.created_at,
      })),
      superseded_chunks: supersededChunks.map((c) => ({
        id: c.id,
        old_content: c.content,
        knowledge_base: kbNameMap.get(c.knowledge_base_id) ?? "Unknown",
        superseded_at: c.valid_to,
      })),
    });
  } catch (err: any) {
    console.error("[check_updates] Error:", err.message);
    res.status(500).json({ error: "Failed to retrieve history" });
  }
});

// ============================================
// /mcp/knowledge-bases — list / create / update
// ============================================
mcpRouter.get("/knowledge-bases", async (req: Request, res: Response) => {
  try {
    const redis = getRedis();
    const userId = req.user!.id;
    const wsIds = await workspaceRepo.getUserWorkspaceIds(redis, userId);
    const kbs = await kbRepo.getKbsByWorkspaces(redis, wsIds);
    res.json({ knowledge_bases: kbs });
  } catch (err: any) {
    console.error("[manage_knowledge_bases] Error:", err.message);
    res.status(500).json({ error: "Failed to list knowledge bases" });
  }
});

mcpRouter.post("/knowledge-bases", async (req: Request, res: Response) => {
  try {
    const redis = getRedis();
    const userId = req.user!.id;
    const { name, description, kb_type, workspace_id } = req.body;

    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    let wsId = workspace_id as string | undefined;
    if (!wsId) {
      const defaultWs = await workspaceRepo.getDefaultWorkspace(redis, userId);
      wsId = defaultWs?.id;
    }
    if (!wsId) {
      res.status(400).json({ error: "No workspace found" });
      return;
    }

    const access = await getWorkspaceAccess(redis, wsId, userId);
    if (!access) {
      res.status(403).json({ error: "No access to the target workspace" });
      return;
    }
    if (!meetsMinimumRole(access.role, "editor")) {
      res.status(403).json({ error: VIEWER_ONLY_MESSAGE, role: access.role });
      return;
    }

    const resolvedType = kb_type ?? "general";
    const kb = await kbRepo.createKb(redis, {
      workspace_id: wsId,
      name,
      description: descriptionForNewKb(resolvedType, description),
      kb_type: resolvedType,
    });

    track(userId, "kb.created", { kb_type: resolvedType, source: "mcp" });
    res.status(201).json(kb);
  } catch (err: any) {
    console.error("[create_knowledge_base] Error:", err.message);
    res.status(500).json({ error: "Failed to create knowledge base" });
  }
});

mcpRouter.patch("/knowledge-bases/:id", async (req: Request, res: Response) => {
  try {
    const redis = getRedis();
    const { id } = req.params;
    const userId = req.user!.id;
    const { name, description } = req.body;

    const kb = await kbRepo.getKb(redis, id);
    if (!kb) {
      res.status(404).json({ error: "Knowledge base not found" });
      return;
    }
    const access = await getWorkspaceAccess(redis, kb.workspace_id, userId);
    if (!access) {
      res.status(403).json({ error: "No access to this knowledge base" });
      return;
    }
    if (!meetsMinimumRole(access.role, "editor")) {
      res.status(403).json({ error: VIEWER_ONLY_MESSAGE, role: access.role });
      return;
    }

    const updated = await kbRepo.updateKb(redis, id, {
      ...(name ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
    });
    res.json(updated);
  } catch (err: any) {
    console.error("[update_knowledge_base] Error:", err.message);
    res.status(500).json({ error: "Failed to update knowledge base" });
  }
});

// ============================================
// POST /mcp/commit-raw — save_session (enqueue; worker is phase 5)
// ============================================
mcpRouter.post("/commit-raw", async (req: Request, res: Response) => {
  try {
    if (process.env.SERVER_SIDE_EXTRACTION !== "true") {
      res.status(503).json({ error: "Server-side extraction is not enabled" });
      return;
    }

    const redis = getRedis();
    const userId = req.user!.id;
    const body = req.body as {
      conversation_text?: unknown;
      knowledge_base_id?: unknown;
      knowledge_base_name?: unknown;
      tool_used?: unknown;
    };
    console.log(
      `[mcp] save_session user=${userId} chars=${
        typeof body.conversation_text === "string" ? body.conversation_text.length : "?"
      } kb_id=${body.knowledge_base_id ?? "(none)"} kb_name=${
        body.knowledge_base_name ?? "(none)"
      } tool=${body.tool_used ?? "?"}`
    );

    if (typeof body.conversation_text !== "string" || body.conversation_text.trim().length === 0) {
      res
        .status(400)
        .json({ error: "conversation_text is required and must be a non-empty string" });
      return;
    }

    const kbIdInput =
      typeof body.knowledge_base_id === "string" && body.knowledge_base_id.trim().length > 0
        ? body.knowledge_base_id
        : undefined;
    const kbNameInput =
      typeof body.knowledge_base_name === "string" && body.knowledge_base_name.trim().length > 0
        ? body.knowledge_base_name.trim()
        : undefined;

    if (kbIdInput && !UUID_RE.test(kbIdInput)) {
      res.status(400).json({ error: "knowledge_base_id must be a valid UUID" });
      return;
    }

    let knowledgeBaseId: string;
    let kbWorkspaceId: string;
    let kbWasCreated = false;
    let deferredRouting = false;

    if (kbIdInput) {
      const kb = await kbRepo.getKb(redis, kbIdInput);
      if (!kb) {
        res.status(404).json({ error: "Knowledge base not found", kb_id: kbIdInput });
        return;
      }
      knowledgeBaseId = kb.id;
      kbWorkspaceId = kb.workspace_id;
    } else if (kbNameInput) {
      const userWsIds = await workspaceRepo.getUserWorkspaceIds(redis, userId);
      if (userWsIds.length === 0) {
        res.status(400).json({ error: "No accessible workspaces for this user — cannot create KB" });
        return;
      }
      const needle = kbNameInput.toLowerCase();
      const existing = (await kbRepo.getKbsByWorkspaces(redis, userWsIds))
        .filter((kb) => kb.name.toLowerCase() === needle)
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];
      if (existing) {
        knowledgeBaseId = existing.id;
        kbWorkspaceId = existing.workspace_id;
      } else {
        const defaultWs = await workspaceRepo.getDefaultWorkspace(redis, userId);
        if (!defaultWs) {
          res.status(400).json({
            error: "No default workspace found for user — cannot auto-create KB. Pass an explicit knowledge_base_id instead.",
          });
          return;
        }
        const access = await getWorkspaceAccess(redis, defaultWs.id, userId);
        if (!access || !meetsMinimumRole(access.role, "editor")) {
          res.status(403).json({ error: VIEWER_ONLY_MESSAGE, role: access?.role });
          return;
        }
        const created = await kbRepo.createKb(redis, {
          workspace_id: defaultWs.id,
          name: kbNameInput,
          description: descriptionForNewKb("general", undefined),
          kb_type: "general",
        });
        knowledgeBaseId = created.id;
        kbWorkspaceId = created.workspace_id;
        kbWasCreated = true;
        console.log(`[mcp] save_session auto-created kb=${knowledgeBaseId} name="${kbNameInput}"`);
      }
    } else {
      // No KB id/name — routing decides post-extraction (phase 5). Use the
      // user's most recently updated KB as a placeholder, else a zero-UUID.
      deferredRouting = true;
      const userWsIds = await workspaceRepo.getUserWorkspaceIds(redis, userId);
      if (userWsIds.length === 0) {
        res.status(400).json({ error: "No accessible workspaces for this user" });
        return;
      }
      const anyKb = (await kbRepo.getKbsByWorkspaces(redis, userWsIds)).sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      )[0];
      if (anyKb) {
        knowledgeBaseId = anyKb.id;
        kbWorkspaceId = anyKb.workspace_id;
      } else {
        const defaultWs = await workspaceRepo.getDefaultWorkspace(redis, userId);
        if (!defaultWs) {
          res.status(400).json({ error: "No default workspace found for user" });
          return;
        }
        knowledgeBaseId = "00000000-0000-0000-0000-000000000000";
        kbWorkspaceId = defaultWs.id;
      }
      console.log(`[mcp] save_session deferred routing — no KB specified`);
    }

    if (!deferredRouting) {
      const access = await getWorkspaceAccess(redis, kbWorkspaceId, userId);
      if (!access) {
        res.status(403).json({ error: "No access to this knowledge base's workspace" });
        return;
      }
      if (!meetsMinimumRole(access.role, "editor")) {
        res.status(403).json({ error: VIEWER_ONLY_MESSAGE, role: access.role });
        return;
      }
    }

    // Rate-limit → deferral (accept the job, set process_after to window roll).
    let processAfter: string | undefined;
    const recentCount = await countRecentJobs(userId, ONE_HOUR_MS);
    if (recentCount >= COMMIT_RAW_RATE_LIMIT_PER_HOUR) {
      const oldestMs = (await oldestJobInWindow(userId, ONE_HOUR_MS)) ?? Date.now();
      processAfter = new Date(oldestMs + ONE_HOUR_MS).toISOString();
      console.log(`[mcp] save_session deferred user=${userId} (${recentCount} in-window) until ${processAfter}`);
    }

    const toolUsed =
      typeof body.tool_used === "string" && body.tool_used.trim().length > 0
        ? body.tool_used
        : undefined;

    const { jobId } = await enqueueJob({
      userId,
      knowledgeBaseId,
      conversationText: body.conversation_text,
      toolUsed,
      processAfter,
    });

    track(userId, "mcp.save_session", {
      knowledge_base_id: knowledgeBaseId,
      tool_used: toolUsed ?? null,
      conversation_length: body.conversation_text.length,
      kb_was_created: kbWasCreated,
      deferred: !!processAfter,
      deferred_routing: deferredRouting,
    });
    recordMcpUsage(userId, "mcp.save_session");

    res.status(202).json({
      job_id: jobId,
      status: "queued",
      knowledge_base_id: deferredRouting ? null : knowledgeBaseId,
      kb_was_created: kbWasCreated,
      deferred_routing: deferredRouting,
      process_after: processAfter ?? null,
      message: processAfter
        ? `Accepted. Hourly cap reached; processing will start at ${processAfter}. Use GET /mcp/jobs/:id to check status.`
        : "Processing in background. Use GET /mcp/jobs/:id to check status.",
    });
  } catch (err: any) {
    console.error("[save_session] Error:", err?.message ?? err);
    res.status(500).json({ error: "Failed to enqueue session" });
  }
});

// ============================================
// GET /mcp/jobs/:id — poll job status
// ============================================
mcpRouter.get("/jobs/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid job id" });
      return;
    }

    const job = await getJobStatus(id);
    if (!job) {
      res.status(404).json({ error: "Job not found", job_id: id });
      return;
    }
    if (job.user_id !== userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    res.json({
      id: job.id,
      status: job.status,
      chunks_created: job.chunks_created,
      chunks_deduplicated: job.chunks_deduplicated,
      chunks_superseded: job.chunks_superseded,
      extraction_model: job.extraction_model,
      extraction_ms: job.extraction_ms,
      pipeline_ms: job.pipeline_ms,
      error_message: job.error_message,
      created_at: job.created_at,
      started_at: job.started_at,
      completed_at: job.completed_at,
      result_json: job.result_json,
    });
  } catch (err: any) {
    console.error("[jobs:get] Error:", err?.message ?? err);
    res.status(500).json({ error: "Failed to fetch job status" });
  }
});
