import mixpanel from "mixpanel-browser";

const token = import.meta.env.VITE_MIXPANEL_TOKEN as string | undefined;

if (token) {
  mixpanel.init(token, {
    autocapture: {
      pageview: "full-url",
      click: true,
      input: false,
      submit: true,
      scroll: false,
      dead_click: true,
      rage_click: true,
      capture_text_content: false,
    },
    track_pageview: false,
    ip: false,
    persistence: "localStorage",
  });
}

const isEnabled = !!token;

type ClientEvent =
  | "page.viewed"
  | "onboarding.started"
  | "onboarding.tool_selected"
  | "onboarding.completed"
  | "kb.viewed"
  | "kb.created_from_dashboard"
  | "chunk.edited"
  | "chunk.deleted"
  | "document.upload_started"
  | "settings.mcp_config_copied"
  | "settings.api_key_generated"
  | "workspace.created"
  | "workspace.switched"
  | "graph.node_clicked";

interface IdentifyProfile {
  email?: string | null;
  name?: string | null;
  createdAt?: string | null;
}

export function identify(userId: string, profile?: IdentifyProfile): void {
  if (!isEnabled) return;
  try {
    mixpanel.identify(userId);
    const props: Record<string, string> = {
      $last_seen: new Date().toISOString(),
    };
    if (profile?.email) props.$email = profile.email;
    const name = profile?.name || profile?.email;
    if (name) props.$name = name;
    if (profile?.createdAt) props.$created = profile.createdAt;
    mixpanel.people.set(props);
  } catch {
    // Silent
  }
}

export function reset(): void {
  if (!isEnabled) return;
  try {
    mixpanel.reset();
  } catch {
    // Silent
  }
}

export function track(
  event: ClientEvent,
  properties?: Record<string, string | number | boolean | null>
): void {
  if (!isEnabled) return;
  try {
    mixpanel.track(event, properties ?? {});
  } catch {
    // Silent
  }
}

export function trackPageView(path: string): void {
  if (!isEnabled) return;
  try {
    mixpanel.track("page.viewed", { path });
  } catch {
    // Silent
  }
}

export default { identify, reset, track, trackPageView };
