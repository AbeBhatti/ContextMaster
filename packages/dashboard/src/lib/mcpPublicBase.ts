/**
 * Base used to build the MCP URLs shown in onboarding and help.
 * Env-driven off VITE_API_URL so this local build advertises the real local
 * MCP endpoint (http://localhost:3001/mcp/protocol) instead of a production
 * host. Falls back to localhost:3001 when VITE_API_URL is unset.
 */
export function getPublicMcpApiBase(): string {
  const raw =
    (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ??
    "";
  return raw || "http://localhost:3001";
}
