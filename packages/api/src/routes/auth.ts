import { Router, type Request, type Response } from "express";
import { getRedis } from "../lib/redis.js";
import { listApiKeys, createApiKey, revokeApiKey } from "../lib/apiKeyRepo.js";
import { track } from "../lib/analytics.js";

// Redis port of the reference's routes/auth.ts. Same dashboard surface
// (current user + API-key management); the data layer is apiKeyRepo instead of
// the Supabase `api_keys` table. The raw key is returned exactly once on
// create. Key prefix is `cm_` (mirrors the reference's `cntxt_`).

export const authRouter = Router();

// GET /api/auth/me
authRouter.get("/me", async (req: Request, res: Response) => {
  res.json({
    id: req.user!.id,
    clerk_id: req.user!.clerk_id,
    email: req.user!.email,
    name: req.user!.name,
    created_at: req.user!.created_at,
  });
});

// GET /api/auth/api-keys
authRouter.get("/api-keys", async (req: Request, res: Response) => {
  try {
    const keys = await listApiKeys(getRedis(), req.user!.id);
    res.json({
      api_keys: keys.map((k) => ({
        id: k.id,
        key_prefix: k.key_prefix,
        name: k.name,
        last_used_at: k.last_used_at,
        created_at: k.created_at,
        revoked_at: k.revoked_at,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to list API keys" });
  }
});

// POST /api/auth/api-keys — generate a new key. Raw key returned ONCE.
authRouter.post("/api-keys", async (req: Request, res: Response) => {
  try {
    const name = (req.body?.name as string | undefined) ?? undefined;
    const { apiKey, rawKey } = await createApiKey(getRedis(), req.user!.id, name);
    track(req.user!.id, "api_key.created", {});
    res.status(201).json({
      id: apiKey.id,
      key_prefix: apiKey.key_prefix,
      name: apiKey.name,
      created_at: apiKey.created_at,
      key: rawKey, // raw key — shown ONCE
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to create API key" });
  }
});

// DELETE /api/auth/api-keys/:id — soft revoke
authRouter.delete("/api-keys/:id", async (req: Request, res: Response) => {
  try {
    const ok = await revokeApiKey(getRedis(), req.user!.id, req.params.id);
    if (!ok) {
      res.status(404).json({ error: "API key not found" });
      return;
    }
    track(req.user!.id, "api_key.revoked", {});
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to revoke API key" });
  }
});
