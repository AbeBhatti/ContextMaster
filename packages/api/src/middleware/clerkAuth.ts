import type { Request, Response, NextFunction } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getRedis } from "../lib/redis.js";
import { upsertUserFromClerk } from "../lib/provisioning.js";
import { AUTH_BYPASS, resolveBypassUser } from "./auth.js";

// Dashboard auth. Verifies a Clerk-issued JWT (RS256) against Clerk's JWKS and
// upserts the matching user (replaces the reference's Supabase upsertUser).
// AUTH_BYPASS short-circuits to the dev user so the dashboard works locally
// without Clerk configured. Byte-for-byte the reference's clerkAuth, repointed
// at the Redis user layer.

const CLERK_JWKS_URL = process.env.CLERK_JWKS_URL; // https://<frontend>.clerk.accounts.dev/.well-known/jwks.json
const CLERK_ISSUER = process.env.CLERK_ISSUER; // https://<frontend>.clerk.accounts.dev

let jwksGetter: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwksGetter && CLERK_JWKS_URL) {
    jwksGetter = createRemoteJWKSet(new URL(CLERK_JWKS_URL));
  }
  return jwksGetter;
}

export async function clerkAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const redis = getRedis();

  // Dev/test bypass — skip JWT verification, use the synthetic dev identity.
  if (AUTH_BYPASS) {
    const user = await resolveBypassUser(redis);
    if (!user) {
      res.status(500).json({ error: "Failed to resolve bypass user" });
      return;
    }
    req.user = user;
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const jwks = getJwks();
    if (!jwks || !CLERK_ISSUER) {
      res.status(500).json({
        error:
          "Clerk JWT verification not configured. Set CLERK_JWKS_URL and CLERK_ISSUER, or AUTH_BYPASS=true.",
      });
      return;
    }

    const { payload } = await jwtVerify(token, jwks, { issuer: CLERK_ISSUER });

    const clerkId = payload.sub as string | undefined;
    const email =
      (payload.email as string | undefined) ??
      (payload["primary_email_address"] as string | undefined);
    const name =
      (payload.name as string | undefined) ??
      ([payload.first_name, payload.last_name].filter(Boolean).join(" ") ||
        null);

    if (!clerkId || !email) {
      res
        .status(401)
        .json({ error: "Token missing required claims (sub, email)" });
      return;
    }

    const user = await upsertUserFromClerk(redis, { clerkId, email, name });
    if (!user) {
      res.status(500).json({ error: "Failed to resolve user" });
      return;
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("[clerkAuth] verify error:", (err as Error).message);
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
