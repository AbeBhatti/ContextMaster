import type { RedisClient } from "./redis.js";
import { k } from "./keys.js";
import { ensureUser } from "./userRepo.js";
import { getDefaultWorkspace, createWorkspace } from "./workspaceRepo.js";
import { createApiKey, hashKey } from "./apiKeyRepo.js";
import { DEV_CLERK_ID } from "../middleware/auth.js";

// Fixed dev API key so it can be pasted into a client once and stay stable
// across restarts. Only meaningful while AUTH_BYPASS=true.
const DEV_API_KEY = process.env.CNTXT_API_KEY?.trim() || "cm_dev_local_key";

// Idempotent dev environment seed. With AUTH_BYPASS=true the MCP loop needs a
// user, a default workspace, and an API key to exist; this creates them once
// and is a no-op on subsequent boots. Real users/workspaces are minted by the
// dashboard + Clerk webhook in later phases.
export async function ensureDevEnvironment(redis: RedisClient): Promise<void> {
  if (process.env.AUTH_BYPASS !== "true") return;

  const user = await ensureUser(redis, {
    clerk_id: DEV_CLERK_ID,
    email: process.env.AUTH_BYPASS_EMAIL || "dev@contextmaster.local",
    name: process.env.AUTH_BYPASS_NAME || "Dev User",
  });

  let ws = await getDefaultWorkspace(redis, user.id);
  if (!ws) {
    ws = await createWorkspace(redis, {
      name: "General",
      owner_id: user.id,
      is_default: true,
      description: "Default workspace.",
    });
  }

  // Ensure the fixed dev key maps to this user (create only if absent).
  const existing = (await redis.get(k.apiKeyByHash(hashKey(DEV_API_KEY)))) as string | null;
  if (!existing) {
    await createApiKey(redis, user.id, "Local dev key", DEV_API_KEY);
  }

  console.log(`[bootstrap] AUTH_BYPASS dev user ready: ${user.email} (${user.id})`);
  console.log(`[bootstrap] default workspace: ${ws.name} (${ws.id})`);
  console.log(`[bootstrap] dev API key: ${DEV_API_KEY}`);
}
