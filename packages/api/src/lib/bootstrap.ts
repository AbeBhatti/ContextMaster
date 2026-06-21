import type { RedisClient } from "./redis.js";
import { k } from "./keys.js";
import { upsertUserFromClerk } from "./provisioning.js";
import { getDefaultWorkspace } from "./workspaceRepo.js";
import { createApiKey, hashKey } from "./apiKeyRepo.js";
import { DEV_CLERK_ID, DEV_EMAIL, DEV_NAME } from "../middleware/auth.js";

// Fixed dev API key so it can be pasted into a client once and stay stable
// across restarts. Only meaningful while AUTH_BYPASS=true.
const DEV_API_KEY = process.env.CNTXT_API_KEY?.trim() || "cm_dev_local_key";

// Idempotent dev environment seed. With AUTH_BYPASS=true the MCP loop needs a
// user, a default workspace, and an API key to exist; this creates them once
// and is a no-op on subsequent boots. Real users/workspaces are minted by the
// dashboard + Clerk webhook in later phases.
export async function ensureDevEnvironment(redis: RedisClient): Promise<void> {
  if (process.env.AUTH_BYPASS !== "true") return;

  // upsertUserFromClerk provisions the user + default workspace + owner
  // membership + Getting Started KB on first run, and is a no-op afterwards —
  // identical to what the Clerk webhook does for real signups.
  const user = await upsertUserFromClerk(redis, {
    clerkId: DEV_CLERK_ID,
    email: DEV_EMAIL,
    name: DEV_NAME,
  });

  const ws = await getDefaultWorkspace(redis, user.id);

  // Ensure the fixed dev key maps to this user (create only if absent).
  const existing = (await redis.get(k.apiKeyByHash(hashKey(DEV_API_KEY)))) as string | null;
  if (!existing) {
    await createApiKey(redis, user.id, "Local dev key", DEV_API_KEY);
  }

  console.log(`[bootstrap] AUTH_BYPASS dev user ready: ${user.email} (${user.id})`);
  if (ws) console.log(`[bootstrap] default workspace: ${ws.name} (${ws.id})`);
  console.log(`[bootstrap] dev API key: ${DEV_API_KEY}`);
}
