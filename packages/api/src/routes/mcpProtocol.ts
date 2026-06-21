import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createCntxtServer } from "./mcpTools.js";

// MCP Streamable HTTP transport. Stateless: each request spins up its own
// McpServer + transport pair, scoped to the API key on the Authorization
// header. mcpAuth must run before this handler — it validates the key and
// populates req.user; we read the raw key here to forward to the internal
// /mcp/* endpoints.
export async function mcpProtocolHandler(req: Request, res: Response): Promise<void> {
  const auth = req.headers.authorization ?? "";
  const apiKey = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  const server = createCntxtServer(apiKey);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err: any) {
    console.error("[mcp-protocol] Error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
}
