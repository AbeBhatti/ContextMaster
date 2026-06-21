// Analytics shim. The reference ships a Mixpanel integration; for the local
// ContextMaster build we keep the exact call sites (track / recordMcpUsage)
// but make them no-ops unless MIXPANEL_TOKEN is set. This preserves service
// parity without a hard dependency on an external analytics service.

type ServerEvent =
  | "mcp.check_memory"
  | "mcp.search_memory"
  | "mcp.save_memory"
  | "mcp.save_session"
  | "mcp.save_session.completed"
  | "mcp.save_session.failed"
  | "mcp.check_updates"
  | "mcp.manage_knowledge_bases"
  | "kb.created"
  | "document.uploaded"
  | "document.processed"
  | "team.invite_sent"
  | "team.invite_accepted"
  | "api_key.created"
  | "api_key.revoked"
  | "user.signup"
  | "super_commit.completed"
  | "super_commit.failed"
  | "super_commit.exhausted";

const enabled = !!process.env.MIXPANEL_TOKEN;

export function track(
  userId: string,
  event: ServerEvent,
  properties?: Record<string, string | number | boolean | null>
): void {
  if (!enabled) return;
  void userId;
  void event;
  void properties;
}

export function recordMcpUsage(userId: string, event: ServerEvent): void {
  if (!enabled) return;
  void userId;
  void event;
}

// People-profile set (Mixpanel $set). No-op without a token; kept for parity
// with the reference's clerkWebhook signup tracking.
export function setUserProfile(
  userId: string,
  properties: Record<string, string | number | boolean | null>
): void {
  if (!enabled) return;
  void userId;
  void properties;
}

export default { track, recordMcpUsage, setUserProfile };
