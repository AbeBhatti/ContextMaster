import { Router, type Request, type Response } from "express";
import { getRedis } from "../lib/redis.js";
import { recall } from "../services/recallService.js";
import * as kbRepo from "../lib/kbRepo.js";
import * as workspaceRepo from "../lib/workspaceRepo.js";

// Dashboard-facing recall endpoint (Clerk-authed). Thin wrapper over the same
// recallService the MCP /mcp/recall route uses — it exists so the Hybrid Search
// Visualization can request the additive `explain` bundle (the two pre-fusion
// arms) with the dashboard's session auth instead of an API key. It does NOT
// change recall behavior; explain is purely additive data alongside `chunks`.
export const recallRouter = Router();

interface DashboardRecallBody {
  query?: string;
  knowledge_base_ids?: string[];
  workspace_id?: string;
  max_results?: number;
  chunk_types?: string[];
  explain?: boolean;
}

recallRouter.post("/", async (req: Request, res: Response) => {
  try {
    const redis = getRedis();
    const userId = req.user!.id;
    const body = (req.body ?? {}) as DashboardRecallBody;

    const query = (body.query ?? "").trim();
    if (!query) {
      res.status(400).json({ error: "query is required" });
      return;
    }

    // Resolve scope. Priority: explicit KB ids > workspace (membership-checked)
    // > default (recall falls back to the user's open-scope KBs).
    let kbIds: string[] | undefined;
    if (body.knowledge_base_ids && body.knowledge_base_ids.length > 0) {
      kbIds = body.knowledge_base_ids;
    } else if (body.workspace_id) {
      const userWsIds = await workspaceRepo.getUserWorkspaceIds(redis, userId);
      if (userWsIds.includes(body.workspace_id)) {
        kbIds = (await kbRepo.getKbsByWorkspace(redis, body.workspace_id)).map((kb) => kb.id);
      }
    }

    const result = await recall({
      query,
      knowledgeBaseIds: kbIds,
      maxResults: body.max_results,
      chunkTypes: body.chunk_types,
      userId,
      explain: body.explain !== false,
    });

    res.json(result);
  } catch (err: any) {
    console.error("[api/recall] Error:", err?.message ?? err);
    res.status(500).json({ error: "Recall search failed" });
  }
});
