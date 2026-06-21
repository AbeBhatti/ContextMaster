import "./loadEnv.js";

import express from "express";
import cors from "cors";
import { getRedis, connectRedis, resolveRedisUrl, redactUrl } from "./lib/redis.js";
import { ensureRedisInfra, listIndexes } from "./lib/indexes.js";
import { idx } from "./lib/keys.js";
import { ensureDevEnvironment } from "./lib/bootstrap.js";
import { mcpAuth } from "./middleware/auth.js";
import { mcpRouter } from "./routes/mcp.js";
import { mcpProtocolHandler } from "./routes/mcpProtocol.js";
import { mcpSSEHandler } from "./routes/mcpSSE.js";
import { startWorker } from "./services/jobService.js";

const PORT = Number(process.env.PORT ?? 3001);
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

// MCP Streamable HTTP transport (remote clients: Claude connectors).
app.all("/mcp/protocol", mcpAuth, mcpProtocolHandler);

// MCP SSE transport (legacy remote clients: Cursor, ChatGPT).
app.get("/mcp/sse", mcpAuth, mcpSSEHandler.get);
app.post("/mcp/sse", mcpAuth, mcpSSEHandler.post);

// MCP REST routes — used by the stdio mcp-client and forwarded to by the
// HTTP transports above over localhost.
app.use("/mcp", mcpAuth, mcpRouter);

// Start the HTTP server immediately; connect to Redis in the background so the
// API boots (and /health responds) even when Redis isn't up yet.
app.listen(PORT, () => {
  console.log(`[api] ContextMaster API listening on http://localhost:${PORT}`);
  console.log(`[api] health:   http://localhost:${PORT}/health`);
  console.log(`[api] MCP REST: http://localhost:${PORT}/mcp/*`);
  console.log(`[api] MCP-RPC:  http://localhost:${PORT}/mcp/protocol  (Streamable HTTP)`);
  console.log(`[api] MCP-SSE:  http://localhost:${PORT}/mcp/sse        (SSE)`);
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
