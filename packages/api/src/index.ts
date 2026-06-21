import "./loadEnv.js";

import express from "express";
import cors from "cors";
import { getRedis, connectRedis, resolveRedisUrl, redactUrl } from "./lib/redis.js";
import { ensureRedisInfra, listIndexes } from "./lib/indexes.js";
import { idx } from "./lib/keys.js";
import { ensureDevEnvironment } from "./lib/bootstrap.js";
import { apiKeyAuth } from "./middleware/apiKeyAuth.js";
import { clerkAuth } from "./middleware/clerkAuth.js";
import { mcpRouter } from "./routes/mcp.js";
import { mcpProtocolHandler } from "./routes/mcpProtocol.js";
import { mcpSSEHandler } from "./routes/mcpSSE.js";
import { authRouter } from "./routes/auth.js";
import { clerkWebhookRouter } from "./routes/clerkWebhook.js";
import { workspacesRouter, publicInvitesRouter } from "./routes/workspaces.js";
import { organizationsRouter } from "./routes/organizations.js";
import { notificationsRouter } from "./routes/notifications.js";
import { billingRouter } from "./routes/billing.js";
import { recallRouter } from "./routes/recall.js";
import { oauthRouter } from "./routes/oauth.js";
import { startWorker } from "./services/jobService.js";

const PORT = Number(process.env.PORT ?? 3001);
const PUBLIC_API_URL = process.env.PUBLIC_API_URL ?? `http://localhost:${PORT}`;
const PUBLIC_DASHBOARD_URL =
  process.env.PUBLIC_DASHBOARD_URL ?? "http://localhost:3000";
const redisUrl = resolveRedisUrl();
const redis = getRedis();

// (Re)build indexes + the jobs consumer group, then seed the dev environment,
// whenever Redis becomes ready — so a fresh container or reconnect always has
// the infra and the AUTH_BYPASS user/workspace/api-key in place.
redis.on("ready", () => {
  ensureRedisInfra(redis)
    .then(() => ensureDevEnvironment(redis))
    .catch((err) => console.error("[redis] infra bootstrap failed:", (err as Error).message));
});

const app = express();
app.use(
  cors({
    origin: "*",
    exposedHeaders: ["Mcp-Session-Id"],
    allowedHeaders: ["Content-Type", "Authorization", "Mcp-Session-Id", "Last-Event-ID", "Accept"],
  })
);

// Clerk webhook — MUST be mounted before express.json() and clerkAuth so svix
// can verify the raw request body. Webhooks authenticate via the svix
// signature, not a Clerk JWT.
app.use("/api/auth", clerkWebhookRouter);

// OAuth 2.0 authorization-server metadata (RFC 8414). Public — no auth.
// OAuth-aware MCP clients read this from the WWW-Authenticate challenge to
// discover our authorize/token endpoints without manual configuration.
app.get("/.well-known/oauth-authorization-server", (_req, res) => {
  res.json({
    issuer: PUBLIC_API_URL,
    authorization_endpoint: `${PUBLIC_DASHBOARD_URL}/oauth/authorize`,
    token_endpoint: `${PUBLIC_API_URL}/oauth/token`,
    registration_endpoint: `${PUBLIC_API_URL}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    scopes_supported: ["mcp"],
  });
});

// OAuth 2.0 protected-resource metadata (RFC 9728).
app.get("/.well-known/oauth-protected-resource", (_req, res) => {
  res.json({
    resource: PUBLIC_API_URL,
    authorization_servers: [PUBLIC_API_URL],
    scopes_supported: ["mcp"],
    bearer_methods_supported: ["header"],
  });
});

// OAuth routes — manage their own auth + body parsing (Clerk for
// /authorize/callback, client_secret/PKCE for /token, none for /register), so
// they're mounted before the global express.json().
app.use("/oauth", oauthRouter);

app.use(express.json({ limit: "10mb" }));

app.get("/health", async (_req, res) => {
  let redisStatus = "down";
  let redisLatencyMs: number | null = null;
  let indexes: { chunks: boolean; kbs: boolean } | null = null;

  if (redis.isReady) {
    try {
      const start = Date.now();
      const pong = await redis.ping();
      redisLatencyMs = Date.now() - start;
      redisStatus = pong === "PONG" ? "ok" : "unexpected";
      const present = await listIndexes(redis);
      indexes = { chunks: present.includes(idx.chunks), kbs: present.includes(idx.kbs) };
    } catch (err) {
      redisStatus = `error: ${(err as Error).message}`;
    }
  }

  res.json({
    service: "contextmaster-api",
    status: "ok",
    redis: { status: redisStatus, latencyMs: redisLatencyMs, url: redactUrl(redisUrl), indexes },
    authBypass: process.env.AUTH_BYPASS === "true",
    serverSideExtraction: process.env.SERVER_SIDE_EXTRACTION === "true",
    timestamp: new Date().toISOString(),
  });
});

// MCP transports + REST authenticate via API key (apiKeyAuth) — used by the
// stdio mcp-client and the remote HTTP/SSE connectors. AUTH_BYPASS-aware in dev.
app.all("/mcp/protocol", apiKeyAuth, mcpProtocolHandler);
app.get("/mcp/sse", apiKeyAuth, mcpSSEHandler.get);
app.post("/mcp/sse", apiKeyAuth, mcpSSEHandler.post);
app.use("/mcp", apiKeyAuth, mcpRouter);

// ---- Dashboard-facing REST API (Clerk JWT auth; AUTH_BYPASS-aware in dev) ----
// Public invite preview is mounted before auth so signed-out users can see an
// invite.
app.use("/api", publicInvitesRouter);
app.use("/api/auth", clerkAuth, authRouter);
app.use("/api/organizations", clerkAuth, organizationsRouter);
app.use("/api/notifications", clerkAuth, notificationsRouter);
app.use("/api/billing", clerkAuth, billingRouter);
app.use("/api/recall", clerkAuth, recallRouter);
app.use("/api", clerkAuth, workspacesRouter);

// Start the HTTP server immediately; connect to Redis in the background so the
// API boots (and /health responds) even when Redis isn't up yet.
app.listen(PORT, () => {
  console.log(`[api] ContextMaster API listening on http://localhost:${PORT}`);
  console.log(`[api] health:   http://localhost:${PORT}/health`);
  console.log(`[api] MCP REST: http://localhost:${PORT}/mcp/*`);
  console.log(`[api] MCP-RPC:  http://localhost:${PORT}/mcp/protocol  (Streamable HTTP)`);
  console.log(`[api] MCP-SSE:  http://localhost:${PORT}/mcp/sse        (SSE)`);
  console.log(`[api] OAuth:    http://localhost:${PORT}/oauth/*`);
  console.log(`[api] OAuth metadata: http://localhost:${PORT}/.well-known/oauth-authorization-server`);
  if (process.env.AUTH_BYPASS === "true") console.log(`[api] AUTH_BYPASS enabled — using dev user`);

  if (process.env.SERVER_SIDE_EXTRACTION === "true") {
    if (!process.env.OPENAI_API_KEY) {
      console.warn(
        "[api] SERVER_SIDE_EXTRACTION=true but OPENAI_API_KEY is missing — save_session jobs will fail until set."
      );
    }
    console.log("[api] Server-side extraction: enabled");
    startWorker();
  } else {
    console.log("[api] Server-side extraction: disabled");
  }
});

connectRedis().catch(() => {
  // lib/redis already logged a friendly message; node-redis keeps retrying.
});

export default app;
