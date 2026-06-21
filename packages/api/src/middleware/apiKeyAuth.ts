import type { Request, Response, NextFunction } from "express";
import { getRedis } from "../lib/redis.js";
import { lookupUserIdByKey } from "../lib/apiKeyRepo.js";
import { getUser } from "../lib/userRepo.js";
import { AUTH_BYPASS, resolveBypassUser } from "./auth.js";

// Public base URL of this API. Used to point Claude (and other OAuth-aware MCP
// clients) at our authorization server via the WWW-Authenticate header.
const PUBLIC_API_URL =
  process.env.PUBLIC_API_URL ?? "http://localhost:3001";

function setOAuthChallenge(res: Response): void {
  // RFC 9728 — point the client at our metadata so it can discover the OAuth
  // flow without us pre-configuring credentials on their side.
  res.setHeader(
    "WWW-Authenticate",
    `Bearer resource_metadata="${PUBLIC_API_URL}/.well-known/oauth-authorization-server"`
  );
}

// MCP auth. Authenticates via API key in `Authorization: Bearer <key>`,
// hashing the key and resolving the owning user (replaces the reference's
// api_keys table lookup). On AUTH_BYPASS we fall back to the dev user so the
// local MCP loop works without a key. On failure we emit the OAuth challenge
// header so Claude/Cursor can discover the auth server and start the flow.
export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const redis = getRedis();
  const authHeader = req.headers.authorization;
  const rawKey = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

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
      console.error("[apiKeyAuth] lookup failed:", (err as Error).message);
    }
  }

  if (AUTH_BYPASS) {
    const devUser = await resolveBypassUser(redis);
    if (devUser) {
      req.user = devUser;
      next();
      return;
    }
    res
      .status(503)
      .json({ error: "Dev user not bootstrapped yet — retry shortly" });
    return;
  }

  setOAuthChallenge(res);
  res.status(401).json({ error: "Invalid or revoked API key" });
}

// Back-compat alias: earlier phases mounted MCP routes under `mcpAuth`.
export const mcpAuth = apiKeyAuth;
