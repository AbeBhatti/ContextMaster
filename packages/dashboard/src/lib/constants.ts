// All visual tokens that need to be referenced in TS (SVG fills, dynamic styles).
// Tailwind handles static classes; this file feeds the rest.

export interface KbTypeColor {
  dot: string;
  glow: string;
  tint: string;
  text: string;
}

// Cool, restrained category palette anchored on the steel-navy accent.
// No purple, no warm tan/brown — distinct muted hues that are contrast-safe on white.
export const KB_TYPE_COLORS: Record<string, KbTypeColor> = {
  software: { dot: "#3d5a80", glow: "rgba(61,90,128,.16)", tint: "#eef2f7", text: "#2b4257" },
  research: { dot: "#4f7d6a", glow: "rgba(79,125,106,.16)", tint: "#eef5f1", text: "#3c5f50" },
  business: { dot: "#3f7a82", glow: "rgba(63,122,130,.16)", tint: "#eef4f5", text: "#305e64" },
  course: { dot: "#6b86a8", glow: "rgba(107,134,168,.16)", tint: "#eef2f7", text: "#46637f" },
  general: { dot: "#64748b", glow: "rgba(100,116,139,.16)", tint: "#f1f4f7", text: "#475569" },
};

export function colorsFor(kbType: string): KbTypeColor {
  return KB_TYPE_COLORS[kbType] ?? KB_TYPE_COLORS.general;
}

export interface ChunkGroupDef {
  id: string;
  label: string;
  accent: string;
  icon: string;
  matches: string[];
}

// Backend stores chunk_type as singular (decision, finding, etc.) — match plural buckets.
export const CHUNK_GROUPS: ChunkGroupDef[] = [
  {
    id: "decisions",
    label: "Decisions",
    accent: "#3d5a80",
    icon: "◆",
    matches: ["decision", "decisions"],
  },
  {
    id: "state",
    label: "Current State",
    accent: "#64748b",
    icon: "●",
    matches: ["state", "current_state"],
  },
  {
    id: "conventions",
    label: "Conventions",
    accent: "#3f7a82",
    icon: "▲",
    matches: ["convention", "conventions"],
  },
  {
    id: "findings",
    label: "Findings",
    accent: "#4f7d6a",
    icon: "✦",
    matches: ["finding", "findings"],
  },
  {
    id: "questions",
    label: "Open Questions",
    accent: "#6b86a8",
    icon: "?",
    matches: ["question", "questions", "open_question"],
  },
  {
    id: "references",
    label: "References",
    accent: "#566273",
    icon: "↗",
    matches: ["reference", "references", "session_summary"],
  },
  {
    id: "context",
    label: "Context & Details",
    accent: "#566273",
    icon: "↳",
    matches: ["context"],
  },
];

export function groupForChunkType(chunkType: string): ChunkGroupDef {
  const lower = chunkType.toLowerCase();
  return (
    CHUNK_GROUPS.find((g) => g.matches.includes(lower)) ??
    CHUNK_GROUPS[CHUNK_GROUPS.length - 1]
  );
}

export const KB_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "general", label: "General" },
  { value: "software", label: "Software" },
  { value: "research", label: "Research" },
  { value: "business", label: "Business" },
  { value: "course", label: "Course" },
];

export const CHUNK_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "decision", label: "Decision" },
  { value: "state", label: "State" },
  { value: "convention", label: "Convention" },
  { value: "finding", label: "Finding" },
  { value: "question", label: "Question" },
  { value: "reference", label: "Reference" },
  { value: "context", label: "Context" },
];

// Member avatar palette — derived from KB types so it matches.
const AVATAR_PALETTE = ["#3d5a80", "#4f7d6a", "#3f7a82", "#6b86a8", "#566273", "#64748b"];
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

export function initialOf(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.split(/[\s—-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? "?";
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

/**
 * Format an absolute future timestamp as "in 7 days" / "in 4 hours" / etc.
 * Returns "expired" for past timestamps so callers don't have to bracket it.
 *
 * Use this instead of formatRelativeTime() for invites and other things with
 * a future expiry — formatRelativeTime() only handles past dates and would
 * say "just now" for any future timestamp.
 */
export function formatTimeUntil(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const ms = then - Date.now();
  if (ms <= 0) return "expired";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return "in <1m";
  const m = Math.floor(seconds / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "in 1 day";
  if (d < 7) return `in ${d} days`;
  const w = Math.floor(d / 7);
  if (w === 1) return "in 1 week";
  if (d < 30) return `in ${w} weeks`;
  const mo = Math.floor(d / 30);
  if (mo === 1) return "in 1 month";
  if (d < 365) return `in ${mo} months`;
  const y = Math.floor(d / 365);
  return y === 1 ? "in 1 year" : `in ${y} years`;
}

// Map MCP tool identifiers (claude_desktop, claude_code, cursor, …) to a
// short label and a glyph that can render anywhere — kept text-only so the
// icon works inside compact history entries without pulling in another asset
// pipeline.
const TOOL_META: Record<string, { label: string; icon: string; tint: string }> = {
  claude_desktop: { label: "Claude", icon: "✦", tint: "#3d5a80" },
  claude_code: { label: "Claude Code", icon: "⌘", tint: "#3d5a80" },
  cursor: { label: "Cursor", icon: "▲", tint: "#18181b" },
  windsurf: { label: "Windsurf", icon: "≋", tint: "#4f7d6a" },
  vscode: { label: "VS Code", icon: "⟪⟫", tint: "#3f7a82" },
  chatgpt: { label: "ChatGPT", icon: "○", tint: "#4f7d6a" },
};

export interface ToolMeta {
  label: string;
  icon: string;
  tint: string;
}

export function toolMeta(toolUsed: string | null | undefined): ToolMeta {
  if (!toolUsed) return { label: "AI tool", icon: "·", tint: "#52525b" };
  const key = toolUsed.toLowerCase().replace(/[^a-z]/g, "_");
  return (
    TOOL_META[key] ?? {
      label: toolUsed,
      icon: "·",
      tint: "#52525b",
    }
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const ALLOWED_DOC_TYPES = ["pdf", "docx", "txt", "md", "csv"];
export const MAX_DOC_SIZE_MB = 10;

export const AUTH_BYPASS_ENABLED = import.meta.env.VITE_AUTH_BYPASS === "true";
export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
export const CLERK_PUBLISHABLE_KEY: string | undefined = import.meta.env
  .VITE_CLERK_PUBLISHABLE_KEY;
