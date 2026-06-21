import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";

// Detects the host AI tool + the active conversation file on disk, so
// save_session can read the transcript directly (zero-payload mode). Ported
// from the reference; Claude Code is the supported platform today.

export interface PlatformInfo {
  platform: "claude-code" | "cursor" | "windsurf" | "vscode" | "unknown";
  conversationDir: string | null;
  currentSessionFile: string | null;
}

function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/[/._]/g, "-");
}

function latestJsonlFile(dir: string): string | null {
  let latest: { file: string; mtimeMs: number } | null = null;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (!st.isFile()) continue;
      if (!latest || st.mtimeMs > latest.mtimeMs) latest = { file: full, mtimeMs: st.mtimeMs };
    } catch {
      // skip unreadable entries
    }
  }
  return latest?.file ?? null;
}

function detectClaudeCode(): PlatformInfo | null {
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const projectsRoot = join(homedir(), ".claude", "projects");
  if (!existsSync(projectsRoot)) return null;

  const conversationDir = join(projectsRoot, encodeProjectPath(projectRoot));
  if (!existsSync(conversationDir)) return null;

  return {
    platform: "claude-code",
    conversationDir,
    currentSessionFile: latestJsonlFile(conversationDir),
  };
}

export function detectPlatform(): PlatformInfo {
  const claudeCode = detectClaudeCode();
  if (claudeCode) return claudeCode;

  if (process.env.CLAUDE_PROJECT_DIR) {
    return { platform: "claude-code", conversationDir: null, currentSessionFile: null };
  }

  return { platform: "unknown", conversationDir: null, currentSessionFile: null };
}
