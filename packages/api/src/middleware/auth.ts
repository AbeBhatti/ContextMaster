import type { RedisClient } from "../lib/redis.js";
import { upsertUserFromClerk } from "../lib/provisioning.js";
import type { User } from "../lib/types.js";

// Express request augmentation — attaches the resolved user, exactly like the
// reference's middleware. Every authenticated handler reads req.user!.id.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

// Dev/test bypass identity. Shared by both auth paths (apiKeyAuth for MCP,
// clerkAuth for the dashboard) so AUTH_BYPASS resolves to the same synthetic
// user everywhere — matching the reference, where both middlewares fall back to
// upsertUser({ clerkId: "dev-bypass-user", ... }).
export const DEV_CLERK_ID =
  process.env.AUTH_BYPASS_CLERK_ID || "dev-bypass-user";
export const DEV_EMAIL =
  process.env.AUTH_BYPASS_EMAIL || "dev@contextmaster.local";
export const DEV_NAME = process.env.AUTH_BYPASS_NAME || "Dev User";

export const AUTH_BYPASS = process.env.AUTH_BYPASS === "true";

// Resolve (and idempotently provision) the AUTH_BYPASS dev user. upsertUser is
// a no-op once the bootstrap seed has run, so this just returns the dev user.
export async function resolveBypassUser(redis: RedisClient): Promise<User | null> {
  try {
    return await upsertUserFromClerk(redis, {
      clerkId: DEV_CLERK_ID,
      email: DEV_EMAIL,
      name: DEV_NAME,
    });
  } catch (err) {
    console.error("[auth] bypass user resolve failed:", (err as Error).message);
    return null;
  }
}
