import type { Request, Response, NextFunction } from "express";
import { getRedis } from "../lib/redis.js";
import { lookupUserIdByKey } from "../lib/apiKeyRepo.js";
import { getUser, getUserByClerkId } from "../lib/userRepo.js";
import type { User } from "../lib/types.js";

// Express request augmentation — attaches the resolved user, exactly like the
// reference's middleware. Every /mcp/* handler reads req.user!.id.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export const DEV_CLERK_ID = process.env.AUTH_BYPASS_CLERK_ID || "dev-bypass-user";

// MCP auth. Two paths, in priority order:
//   1. Valid `Authorization: Bearer <api key>` → resolve the owning user.
//   2. AUTH_BYPASS=true → fall back to the seeded dev user (no/invalid key OK).
// Real Clerk JWT auth for the dashboard is wired in phase 7; MCP stays on the
// API-key + bypass model the whole way through.
export async function mcpAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const redis = getRedis();
  const authHeader = req.headers.authorization;
  const rawKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (rawKey && rawKey.length >= 10) {
    try {
      const userId = await lookupUserIdByKey(redis, rawKey);
      if (userId) {
        const user = await getUser(redis, userId);
        if (user) {
          req.user = user;
          next();
          return;
        }
      }
    } catch (err) {
      console.error("[auth] api-key lookup failed:", (err as Error).message);
    }
  }

  if (process.env.AUTH_BYPASS === "true") {
    const devUser = await getUserByClerkId(redis, DEV_CLERK_ID);
    if (devUser) {
      req.user = devUser;
      next();
      return;
    }
    res.status(503).json({ error: "Dev user not bootstrapped yet — retry shortly" });
    return;
  }

  res.status(401).json({ error: "Missing or invalid API key" });
}
