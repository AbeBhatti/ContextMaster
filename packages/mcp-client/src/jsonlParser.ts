import { readFileSync } from "node:fs";

// Parses a Claude Code JSONL session file into clean "User: ... / AI: ..."
// text for the server-side extractor. Ported verbatim from the reference.

export interface ParsedMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

export interface ParsedConversation {
  messages: ParsedMessage[];
  rawText: string;
  messageCount: number;
  lastMessageTimestamp: string | null;
}

const EMPTY: ParsedConversation = {
  messages: [],
  rawText: "",
  messageCount: 0,
  lastMessageTimestamp: null,
};

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("\n");
}

function parse(filePath: string, sinceTimestamp: string | null): ParsedConversation {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return { ...EMPTY };
  }

  const messages: ParsedMessage[] = [];
  let lastMessageTimestamp: string | null = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let record: any;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const type = record?.type;
    if (type !== "user" && type !== "assistant") continue;

    const timestamp = typeof record?.timestamp === "string" ? record.timestamp : undefined;
    if (sinceTimestamp && timestamp && timestamp <= sinceTimestamp) continue;

    const text = extractText(record?.message?.content).trim();
    if (!text) continue;

    messages.push({ role: type, content: text, timestamp });
    if (timestamp) lastMessageTimestamp = timestamp;
  }

  const rawText = messages
    .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content}`)
    .join("\n\n");

  return { messages, rawText, messageCount: messages.length, lastMessageTimestamp };
}

export function parseJsonlFile(filePath: string): ParsedConversation {
  return parse(filePath, null);
}

export function parseJsonlSince(filePath: string, sinceTimestamp: string): ParsedConversation {
  return parse(filePath, sinceTimestamp);
}
