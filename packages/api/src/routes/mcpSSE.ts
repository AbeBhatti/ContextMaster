import type { Request, Response } from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createCntxtServer } from "./mcpTools.js";

// SSE transport (legacy remote clients — Cursor, ChatGPT). Stateful: a
// long-lived GET holds the event stream open and the client POSTs JSON-RPC
// messages to a paired endpoint that routes back into that exact stream. The
// SDK assigns a sessionId at construction time; we track live transports by it.
const activeTransports = new Map<string, SSEServerTransport>();

async function handleGet(req: Request, res: Response): Promise<void> {
  const auth = req.headers.authorization ?? "";
  const apiKey = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  const server = createCntxtServer(apiKey);
  const transport = new SSEServerTransport("/mcp/sse", res as unknown as ServerResponse);
  const sessionId = transport.sessionId;

  activeTransports.set(sessionId, transport);

  res.on("close", () => {
    activeTransports.delete(sessionId);
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
  } catch (err: any) {
    console.error("[mcp-sse] GET error:", err.message);
    activeTransports.delete(sessionId);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
}

async function handlePost(req: Request, res: Response): Promise<void> {
  const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : "";
  if (!sessionId) {
    res.status(400).json({ error: "Missing sessionId query parameter" });
    return;
  }
  const transport = activeTransports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  try {
    await transport.handlePostMessage(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      req.body
    );
  } catch (err: any) {
    console.error("[mcp-sse] POST error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
}

export const mcpSSEHandler = { get: handleGet, post: handlePost };
