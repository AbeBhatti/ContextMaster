import { Router, Request, Response } from "express";
import { randomBytes, createHash } from "node:crypto";
import express from "express";
import { getRedis } from "../lib/redis.js";
import {
  createClient,
  getClient,
  createAuthCode,
  getAuthCode,
  markAuthCodeUsed,
} from "../lib/oauthRepo.js";
import { createApiKey } from "../lib/apiKeyRepo.js";
import { clerkAuth } from "../middleware/clerkAuth.js";

// OAuth 2.1 authorization-code flow with PKCE. Lets OAuth-aware MCP clients
// (Claude Settings → Connectors) connect without a manually pasted API key:
// the access token they receive IS a minted API key. Redis-backed port of the
// reference's oauth.ts — same endpoints, same validation, same Claude callback
// equivalence handling.

export const oauthRouter = Router();

const formParser = express.urlencoded({ extended: true });

const PUBLIC_DASHBOARD_URL =
  process.env.PUBLIC_DASHBOARD_URL ?? "http://localhost:3000";

// Anthropic's docs note the callback host may flip from claude.ai to claude.com;
// treat the two callback URLs as equivalent everywhere we validate redirect_uri.
const CLAUDE_CALLBACK_AI = "https://claude.ai/api/mcp/auth_callback";
const CLAUDE_CALLBACK_COM = "https://claude.com/api/mcp/auth_callback";

function isClaudeCallback(uri: string): boolean {
  return uri === CLAUDE_CALLBACK_AI || uri === CLAUDE_CALLBACK_COM;
}

function redirectUriAllowed(registered: string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  if (isClaudeCallback(requested) && registered.some(isClaudeCallback))
    return true;
  return false;
}

function expandClaudeCallbacks(uris: string[]): string[] {
  const out = [...uris];
  if (
    uris.some((u) => u === CLAUDE_CALLBACK_AI) &&
    !uris.includes(CLAUDE_CALLBACK_COM)
  )
    out.push(CLAUDE_CALLBACK_COM);
  if (
    uris.some((u) => u === CLAUDE_CALLBACK_COM) &&
    !uris.includes(CLAUDE_CALLBACK_AI)
  )
    out.push(CLAUDE_CALLBACK_AI);
  return out;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function base64UrlSha256(input: string): string {
  return createHash("sha256")
    .update(input)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ============================================
// POST /oauth/register — Dynamic client registration (RFC 7591)
// ============================================
oauthRouter.post(
  "/register",
  express.json(),
  async (req: Request, res: Response) => {
    const { client_name, redirect_uris, token_endpoint_auth_method } =
      req.body ?? {};

    if (
      !Array.isArray(redirect_uris) ||
      redirect_uris.length === 0 ||
      redirect_uris.some((u: unknown) => typeof u !== "string")
    ) {
      res.status(400).json({
        error: "invalid_redirect_uri",
        error_description: "redirect_uris must be a non-empty array of strings",
      });
      return;
    }

    const redis = getRedis();
    const clientId = `cm_${randomBytes(16).toString("hex")}`;
    const clientSecret = randomBytes(32).toString("hex");
    const clientSecretHash = sha256(clientSecret);

    // Auto-register both claude.ai and claude.com callbacks so the client works
    // regardless of which host Claude Desktop/Web ends up using.
    const storedRedirectUris = expandClaudeCallbacks(redirect_uris);

    try {
      await createClient(redis, {
        client_id: clientId,
        client_secret_hash: clientSecretHash,
        name: client_name ?? "Unknown client",
        redirect_uris: storedRedirectUris,
        token_endpoint_auth_method:
          token_endpoint_auth_method ?? "client_secret_post",
      });
    } catch (err) {
      console.error("[oauth/register] insert error:", (err as Error).message);
      res.status(500).json({ error: "server_error" });
      return;
    }

    res.status(201).json({
      client_id: clientId,
      client_secret: clientSecret,
      client_secret_expires_at: 0,
      client_name: client_name ?? "Unknown client",
      redirect_uris: storedRedirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method:
        token_endpoint_auth_method ?? "client_secret_post",
    });
  }
);

// ============================================
// GET /oauth/authorize — Authorization endpoint
// Validates client/redirect_uri, then forwards the browser to the dashboard
// where Clerk session cookies are readable. The dashboard finishes the flow by
// POSTing to /oauth/authorize/callback below with a verified JWT.
// ============================================
oauthRouter.get("/authorize", async (req: Request, res: Response) => {
  const {
    response_type,
    client_id,
    redirect_uri,
    state,
    scope,
    code_challenge,
    code_challenge_method,
  } = req.query as Record<string, string | undefined>;

  if (response_type !== "code") {
    res.status(400).send("response_type must be 'code'");
    return;
  }
  if (!client_id || !redirect_uri) {
    res.status(400).send("Missing client_id or redirect_uri");
    return;
  }

  const redis = getRedis();
  const client = await getClient(redis, client_id);
  if (!client) {
    res.status(400).send("Unknown client_id");
    return;
  }
  if (!redirectUriAllowed(client.redirect_uris, redirect_uri)) {
    res.status(400).send("redirect_uri not registered for this client");
    return;
  }

  const dashboardUrl = new URL("/oauth/authorize", PUBLIC_DASHBOARD_URL);
  dashboardUrl.searchParams.set("response_type", "code");
  dashboardUrl.searchParams.set("client_id", client_id);
  dashboardUrl.searchParams.set("redirect_uri", redirect_uri);
  if (state) dashboardUrl.searchParams.set("state", state);
  dashboardUrl.searchParams.set("scope", scope ?? "mcp");
  if (code_challenge) {
    dashboardUrl.searchParams.set("code_challenge", code_challenge);
    dashboardUrl.searchParams.set(
      "code_challenge_method",
      code_challenge_method ?? "S256"
    );
  }
  res.redirect(dashboardUrl.toString());
});

// ============================================
// POST /oauth/authorize/callback — Dashboard hand-off
// Called by the dashboard after the user has signed in with Clerk. clerkAuth
// identifies the user; we mint the auth code and return the redirect URL.
// ============================================
oauthRouter.post(
  "/authorize/callback",
  express.json(),
  clerkAuth,
  async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const {
      client_id,
      redirect_uri,
      state,
      scope,
      code_challenge,
      code_challenge_method,
    } = (req.body ?? {}) as Record<string, string | undefined>;

    if (!client_id || !redirect_uri) {
      res.status(400).json({
        error: "invalid_request",
        error_description: "Missing client_id or redirect_uri",
      });
      return;
    }

    const redis = getRedis();
    const client = await getClient(redis, client_id);
    if (!client) {
      res.status(400).json({ error: "invalid_client" });
      return;
    }
    if (!redirectUriAllowed(client.redirect_uris, redirect_uri)) {
      res.status(400).json({
        error: "invalid_request",
        error_description: "redirect_uri not registered",
      });
      return;
    }

    const code = randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 10 * 60_000;

    try {
      await createAuthCode(redis, {
        code,
        client_id,
        user_id: user.id,
        redirect_uri,
        scope: scope ?? "mcp",
        code_challenge: code_challenge ?? null,
        code_challenge_method: code_challenge_method || "S256",
        expires_at: expiresAt,
      });
    } catch (err) {
      console.error(
        "[oauth/authorize/callback] code insert error:",
        (err as Error).message
      );
      res.status(500).json({ error: "server_error" });
      return;
    }

    const url = new URL(redirect_uri);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);

    res.json({ redirect_url: url.toString() });
  }
);

// ============================================
// POST /oauth/token — Token endpoint
// Server-to-server call from the client's backend. Authenticates via
// client_id+client_secret in the body, or PKCE for public clients.
// ============================================
oauthRouter.post(
  "/token",
  formParser,
  express.json(),
  async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const {
      grant_type,
      code,
      redirect_uri,
      client_id: bodyClientId,
      client_secret,
      code_verifier,
    } = body;

    if (grant_type !== "authorization_code") {
      res.status(400).json({
        error: "unsupported_grant_type",
        error_description: "Only authorization_code is supported",
      });
      return;
    }

    if (!code || !redirect_uri) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    const redis = getRedis();

    const codeRow = await getAuthCode(redis, code);
    if (!codeRow) {
      res
        .status(400)
        .json({ error: "invalid_grant", error_description: "Code not found" });
      return;
    }
    if (codeRow.used_at) {
      res
        .status(400)
        .json({ error: "invalid_grant", error_description: "Code already used" });
      return;
    }
    if (codeRow.expires_at < Date.now()) {
      res
        .status(400)
        .json({ error: "invalid_grant", error_description: "Code expired" });
      return;
    }

    const redirectUriEquivalent =
      codeRow.redirect_uri === redirect_uri ||
      (isClaudeCallback(codeRow.redirect_uri) && isClaudeCallback(redirect_uri));
    if (!redirectUriEquivalent) {
      res.status(400).json({
        error: "invalid_grant",
        error_description: "redirect_uri mismatch",
      });
      return;
    }

    if (bodyClientId && bodyClientId !== codeRow.client_id) {
      res.status(400).json({
        error: "invalid_grant",
        error_description: "Client mismatch",
      });
      return;
    }
    const client_id = bodyClientId ?? codeRow.client_id;
    if (!client_id) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    const client = await getClient(redis, client_id);
    if (!client) {
      res.status(401).json({ error: "invalid_client" });
      return;
    }

    // Client authentication: confidential (client_secret) OR public (PKCE).
    if (client_secret) {
      if (sha256(client_secret) !== client.client_secret_hash) {
        res.status(401).json({ error: "invalid_client" });
        return;
      }
    } else if (!code_verifier) {
      res.status(401).json({ error: "invalid_client" });
      return;
    }

    // PKCE verification: if a challenge was stored, the verifier must match.
    if (codeRow.code_challenge) {
      if (!code_verifier) {
        res.status(400).json({
          error: "invalid_grant",
          error_description: "code_verifier required",
        });
        return;
      }
      const method = codeRow.code_challenge_method ?? "S256";
      const expected =
        method === "plain" ? code_verifier : base64UrlSha256(code_verifier);
      if (expected !== codeRow.code_challenge) {
        res.status(400).json({
          error: "invalid_grant",
          error_description: "PKCE verification failed",
        });
        return;
      }
    }

    // Mark the code as used (single-use).
    await markAuthCodeUsed(redis, code);

    // Mint an API key for the user — this IS the access token.
    const accessToken = `cm_oauth_${randomBytes(32).toString("hex")}`;
    try {
      await createApiKey(
        redis,
        codeRow.user_id,
        `${client.name} connector`,
        accessToken
      );
    } catch (err) {
      console.error(
        "[oauth/token] api key mint error:",
        (err as Error).message
      );
      res.status(500).json({ error: "server_error" });
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      scope: codeRow.scope ?? "mcp",
    });
  }
);
