// All visual tokens that need to be referenced in TS (SVG fills, dynamic styles).
// Tailwind handles static classes; this file feeds the rest.

export interface KbTypeColor {
  dot: string;
  glow: string;
  tint: string;
  text: string;
}

export const KB_TYPE_COLORS: Record<string, KbTypeColor> = {
  software: { dot: "#5b8def", glow: "rgba(91,141,239,.30)", tint: "#e8efff", text: "#2f56b8" },
  research: { dot: "#5fa57a", glow: "rgba(95,165,122,.30)", tint: "#e8f3ec", text: "#2f6b48" },
  business: { dot: "#a87bc7", glow: "rgba(168,123,199,.30)", tint: "#f1eaf6", text: "#6b3f8c" },
  course: { dot: "#d6a24a", glow: "rgba(214,162,74,.30)", tint: "#f8efdb", text: "#8a5e1f" },
  general: { dot: "#8a8473", glow: "rgba(138,132,115,.30)", tint: "#ede9df", text: "#56523f" },
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
    accent: "#5b8def",
    icon: "◆",
    matches: ["decision", "decisions"],
  },
  {
    id: "state",
    label: "Current State",
    accent: "#8a8473",
    icon: "●",
    matches: ["state", "current_state"],
  },
  {
    id: "conventions",
    label: "Conventions",
    accent: "#a87bc7",
    icon: "▲",
    matches: ["convention", "conventions"],
  },
  {
    id: "findings",
    label: "Findings",
    accent: "#5fa57a",
    icon: "✦",
    matches: ["finding", "findings"],
  },
  {
    id: "questions",
    label: "Open Questions",
    accent: "#d6a24a",
    icon: "?",
    matches: ["question", "questions", "open_question"],
  },
  {
    id: "references",
    label: "References",
    accent: "#7a8a99",
    icon: "↗",
    matches: ["reference", "references", "session_summary"],
  },
  {
    id: "context",
    label: "Context & Details",
    accent: "#7a8a99",
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
const AVATAR_PALETTE = ["#d6a24a", "#5b8def", "#5fa57a", "#a87bc7", "#7a8a99", "#8a8473"];
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
  claude_desktop: { label: "Claude", icon: "✦", tint: "#cf7d4a" },
  claude_code: { label: "Claude Code", icon: "⌘", tint: "#cf7d4a" },
  cursor: { label: "Cursor", icon: "▲", tint: "#3a3320" },
  windsurf: { label: "Windsurf", icon: "≋", tint: "#5fa57a" },
  vscode: { label: "VS Code", icon: "⟪⟫", tint: "#5b8def" },
  chatgpt: { label: "ChatGPT", icon: "○", tint: "#5fa57a" },
};

export interface ToolMeta {
  label: string;
  icon: string;
  tint: string;
}

export function toolMeta(toolUsed: string | null | undefined): ToolMeta {
  if (!toolUsed) return { label: "AI tool", icon: "·", tint: "#8a8473" };
  const key = toolUsed.toLowerCase().replace(/[^a-z]/g, "_");
  return (
    TOOL_META[key] ?? {
      label: toolUsed,
      icon: "·",
      tint: "#8a8473",
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
