// Server-side knowledge extraction from raw conversation text.
//
// The save_session MCP tool / POST /mcp/commit-raw path receives the raw
// conversation transcript and hands it here. This module turns it into the
// same structured-chunk + session-summary shape that POST /mcp/commit
// expects, so jobService can replay the existing commit pipeline without
// changing any of its downstream consumers.
//
// Two LLM passes, both gpt-4o-mini, response_format=json_object:
//   Pass 1: typed structured chunks (decision/finding/convention/state/
//           question/reference) + session_summary + next_steps +
//           open_questions. Includes a "label" on every emitted chunk.
//   Pass 2: context chunks linked to Pass 1 labels via related_to_labels.
//
// A deterministic post-process step runs after both passes: it scans the raw
// text for proper nouns, URLs, and numbers that didn't make it into any
// chunk and emits supplementary reference chunks. The commit pipeline runs
// its own coverage check against the session_summary later — this one
// catches details the LLM dropped from the summary itself.

import OpenAI from "openai";
import {
  extractEntities,
  type ExtractedEntity,
} from "./entityExtractor.js";

// ============================================
// Public types
// ============================================

export type ExtractionChunkType =
  | "decision"
  | "finding"
  | "convention"
  | "state"
  | "question"
  | "reference"
  | "context";

export interface ExtractionChunk {
  content: string;
  chunk_type: ExtractionChunkType;
  topic_tags: string[];
  topic_key?: string;
  label?: string;
  related_to_labels?: string[];
}

export interface ExtractionTimings {
  normalization_ms: number;
  pass1_ms: number;
  pass1_chunks: number;
  pass2_ms: number;
  pass2_chunks: number;
  postprocess_ms: number;
  backfill_tags_ms: number;
  total_extraction_ms: number;
}

export interface ExtractionResult {
  chunks: ExtractionChunk[];
  sessionSummary: string;
  nextSteps: string[];
  openQuestions: string[];
  model: string;
  passes: number;
  timings?: ExtractionTimings;
}

export interface ExtractFromConversationParams {
  conversationText: string;
  toolUsed?: string;
  // Retry path. When true, runs a stripped-down extraction prompt that
  // drops Pass 2 and self-verification — much shorter input + output, less
  // likely to overwhelm gpt-4o-mini on edge-case conversations. Set by
  // jobService when retry_count > 0.
  simplified?: boolean;
}

// ============================================
// OpenAI client (lazy init, same pattern as superCommitService)
// ============================================

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EXTRACTION_MODEL = process.env.EXTRACTION_MODEL || "gpt-4o-mini";
// gpt-4o-mini supports 16k output tokens. We give the extractor a generous
// ceiling because a long conversation can legitimately produce 30-60 chunks
// (the save_memory rules explicitly forbid a chunk cap).
const EXTRACTION_MAX_TOKENS = 8192;

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured for server-side extraction");
  }
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
  return openaiClient;
}

export function isExtractionConfigured(): boolean {
  return !!OPENAI_API_KEY;
}

// ============================================
// Normalisation
// ============================================

// Tool-specific turn markers we collapse to "User:" / "AI:" so the LLM sees a
// consistent transcript regardless of source. Order matters: longer markers
// first so we don't half-match a substring.
const TURN_MARKER_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  { re: /^Human:\s*/gim, replacement: "User: " },
  { re: /^Assistant:\s*/gim, replacement: "AI: " },
  { re: /^ChatGPT:\s*/gim, replacement: "AI: " },
  { re: /^GPT:\s*/gim, replacement: "AI: " },
  { re: /^Claude:\s*/gim, replacement: "AI: " },
  { re: /^Cursor:\s*/gim, replacement: "AI: " },
  { re: /^You:\s*/gim, replacement: "User: " },
];

// Lines matching this look like terminal output / log dumps. Conservative
// heuristic — only used after we've already split on blank lines, so a
// rare false positive trims a paragraph rather than dropping the whole text.
const TERMINAL_LINE_HINT = /^(?:\$\s|>\s|[+\-#]\s|\d{2}:\d{2}:\d{2}|\[?\d{4}-\d{2}-\d{2})/;

const DIFF_HEADER = /^(?:diff --git|---|\+\+\+|@@)/;

/**
 * Strip tool-specific noise from a raw transcript before extraction.
 *
 * Goals: cut the token bill on dumps the LLM doesn't need to read, while
 * preserving every substantive sentence (names, numbers, URLs, decisions).
 * The trade-off skews toward keeping content — when in doubt, we don't trim.
 */
export function normalizeConversation(
  text: string,
  _toolUsed?: string
): string {
  let out = text;

  // 1. Data echo prevention: drop any line that begins with the
  // "[from knowledge base: ...]" tag the recall path injects. The save_memory
  // rules explicitly forbid re-extracting recalled content, so we cut it at
  // the normaliser before the LLM ever sees it.
  out = out
    .split(/\r?\n/)
    .filter((line) => !/^\s*\[from knowledge base:/i.test(line))
    .join("\n");

  // 2. Strip Claude thinking / artifact blocks. Match both with and without
  // the antml: prefix — different transports surface them differently.
  out = out.replace(/<(?:antml:)?thinking>[\s\S]*?<\/(?:antml:)?thinking>/gi, "");
  out = out.replace(/<(?:antml:)?artifact[^>]*>[\s\S]*?<\/(?:antml:)?artifact>/gi, "");

  // 3. Strip Claude tool_use / tool_result JSON blocks. These look like
  //    {"type":"tool_use", ...}  — multi-line, sometimes nested. We approximate
  //    with a non-greedy match anchored on the type field.
  out = out.replace(
    /\{\s*"type"\s*:\s*"tool_use"[\s\S]*?\}\s*(?=\n|$)/g,
    ""
  );
  out = out.replace(
    /\{\s*"type"\s*:\s*"tool_result"[\s\S]*?\}\s*(?=\n|$)/g,
    ""
  );

  // 4. Truncate long terminal/log dumps and file diffs to keep the first 10
  //    and last 10 lines. We operate on blank-line-separated paragraphs so
  //    we don't accidentally splice prose. A paragraph triggers truncation
  //    only when the majority of its lines look like dump output AND its
  //    length crosses the 30/50 thresholds.
  const paragraphs = out.split(/\n{2,}/);
  for (let i = 0; i < paragraphs.length; i++) {
    const lines = paragraphs[i].split(/\r?\n/);
    if (lines.length < 30) continue;

    const diffHits = lines.filter((l) => DIFF_HEADER.test(l)).length;
    const terminalHits = lines.filter((l) => TERMINAL_LINE_HINT.test(l)).length;

    // File diff: > 30 lines and at least one diff-header line.
    if (lines.length > 30 && diffHits >= 1) {
      const kept = [
        ...lines.slice(0, 10),
        `[...truncated ${lines.length - 10} diff lines...]`,
      ];
      paragraphs[i] = kept.join("\n");
      continue;
    }

    // Terminal/log dump: > 50 lines and at least 60% look terminal-ish.
    if (lines.length > 50 && terminalHits / lines.length >= 0.6) {
      const kept = [
        ...lines.slice(0, 10),
        `[...truncated ${lines.length - 20} lines...]`,
        ...lines.slice(-10),
      ];
      paragraphs[i] = kept.join("\n");
    }
  }
  out = paragraphs.join("\n\n");

  // 5. Normalise turn markers last so the regex-style replacements don't
  //    fight the truncation step above.
  for (const { re, replacement } of TURN_MARKER_PATTERNS) {
    out = out.replace(re, replacement);
  }

  // Collapse runs of 3+ blank lines that the strip passes left behind.
  out = out.replace(/\n{3,}/g, "\n\n").trim();

  return out;
}

// ============================================
// Pass 1: structured chunks
// ============================================

const PASS_1_SYSTEM_PROMPT = `You are a knowledge extraction system. You read raw AI-assisted conversations and produce structured knowledge chunks that another system will store in a long-term knowledge base. Your output is consumed by a deterministic pipeline — return ONLY valid JSON, no prose, no markdown fences.

# Your job

Extract every NEW, substantive piece of knowledge from the conversation: decisions made, findings discovered, conventions established, current state, open questions, and references. Then write a rich session_summary that mentions every proper noun, number, URL, file path, deadline, and person name in the conversation as a safety net.

# Chunk types (use exactly these strings)

- "decision":   A choice that was made, with rationale. e.g. "Decision: Use PostgreSQL over MongoDB for the primary database. Rationale: need JSONB + pgvector."
- "finding":    Something discovered or learned. e.g. "Finding: PgBouncer pool sizing of 25 was hitting connection limits at peak load."
- "convention": A pattern, rule, or standard established. e.g. "Convention: All API routes return JSON with a top-level 'error' field on failure."
- "state":      Current status of something — single current value that could change in a future session. e.g. "State: API deployed at https://api.contextcloud.pro on Railway Pro."
- "question":   An open question or unresolved issue.
- "reference":  A factual data point: configuration value, URL, GitHub repo, env var name+value, pricing, CNAME, polling interval, error message. Capture EXACTLY — including the value.

# CRITICAL RULES — every one of these must be followed

## 1. SPECIFICITY RULE — NEVER GENERALISE
Preserve proper nouns, numbers, URLs, paths, version strings, config values, error messages, thresholds verbatim. If the conversation says "PostgreSQL 15.4 on port 5432", the chunk says "PostgreSQL 15.4 on port 5432" — never "a recent Postgres version" or "the database".

WRONG: "User moved from their home country"
RIGHT: "User moved from Sweden"

WRONG: "Configured the database connection"
RIGHT: "Configured PostgreSQL on port 5432 at db.railway.internal"

WRONG: "Uses a caching library"
RIGHT: "Uses Redis with ioredis client, TTL 3600s"

WRONG: "Use MiniLM-L6-v2 as the base model"  (dropped the "all-" prefix)
RIGHT: "Use all-MiniLM-L6-v2 as the base model"

WRONG: "Deploy to us-east"  (dropped the "-1" region suffix)
RIGHT: "Deploy to us-east-1"

WRONG: "Run gpt-4o instead of gpt-4"  (dropped the "-mini" model variant)
RIGHT: "Run gpt-4o-mini instead of gpt-4"

If you find yourself writing a category noun where a proper noun exists, you are violating this rule. Hyphenated identifiers (model names, region codes, version slugs) MUST be copied character-for-character — never drop a prefix like "all-", a suffix like "-mini", or a number suffix like "-1". When in doubt, copy the exact string from the conversation.

## 2. ATTRIBUTION RULE — preserve WHO
When a decision, finding, or statement came from a specific person, preserve them. If a person is NAMED in the conversation as having set up, owns, decided, configured, requested, deployed, or built something, the chunk capturing that fact MUST name them. Dropping the name because the fact "stands on its own" is a violation — the name IS part of the fact.

WRONG: "Decided to use Redis for caching"
RIGHT: "Team decided to use Redis for caching" or "User chose Redis for caching"

WRONG: "The deadline is Friday"
RIGHT: "Manager set the deadline for Friday" or "Client requested delivery by Friday"

WRONG: "Existing Kafka cluster at kafka-prod:9092 with 24 partitions"
RIGHT: "Sarah (platform team) set up the existing Kafka cluster at kafka-prod:9092; she expanded it to 24 partitions last week"

WRONG: "Negotiated $0.30/GB pricing with ClickHouse Cloud"
RIGHT: "Jake negotiated $0.30/GB pricing with ClickHouse Cloud"

For AI-assisted sessions, attribution is usually "User decided ..." or "User and AI explored ..." — don't attribute decisions to the AI tool unless the user explicitly deferred to it. But person names that DO appear in the conversation (teammates, stakeholders, vendors) always go into the chunk content verbatim.

ATTRIBUTION APPLIES TO REFERENCE CHUNKS TOO. If a URL, doc, template, config file, or resource was created or maintained by a named person, the reference chunk must say so.

WRONG: "Reference: Custom claim template at https://clerk.com/docs/sessions/custom-claims"  (drops who wrote it)
RIGHT: "Reference: Custom claim template at https://clerk.com/docs/sessions/custom-claims. Anh (auth team) wrote the template config; JSON lives in the Clerk dashboard."

WRONG: "Reference: Migration runbook at docs/migrate.md"  (drops who owns it)
RIGHT: "Reference: Migration runbook at docs/migrate.md, owned by Priya on platform"

## 3. OPERATIONAL CONTEXT RULE — always emit standalone chunks for these
Even when mentioned in passing, these go into their own reference (or state) chunk:
- Repo paths and locations (local paths, GitHub URLs)
- Deployment URLs (production, staging, API endpoints)
- Team member names and roles
- Environment variable names + values
- Tool / service accounts (which Supabase project, which Railway app, which Clerk instance)
- File paths that are frequently referenced
- Authentication details (provider, project ID)
- CNAME / DNS records, ports, polling intervals, thresholds, pricing numbers
- Error messages encountered
- Account / credential mappings

These are foundational facts that every future session needs but no future session will re-state.

## 4. TOPIC_KEY — only on state and decision chunks
Kebab-case, 2-5 words, specific. Identifies WHAT is being decided / configured, so a later session reusing the same key supersedes this chunk deterministically.

  topic_key: "primary-database"        — for the decision about which DB to use
  topic_key: "production-api-url"      — for the live API URL state
  topic_key: "dashboard-api-style"     — for the choice of GraphQL vs REST
  topic_key: "hosting-platform"        — for "we host on Railway Pro"
  topic_key: "frontend-team-lead"      — for "Sarah leads frontend"
  topic_key: "current-sprint-deadline" — for "deadline is Friday March 14"

Rules:
- ONLY on chunk_type="state" or "decision". Findings, references, contexts, questions never get one.
- Be specific: "primary-database" not "database". Separate decisions about primary DB and cache DB need separate keys.
- Be consistent: if you'd use "hosting-platform" once, use it for the same concept again.
- Skip topic_key on additive facts (features built, bugs found, meetings held).

## 5. NO CHUNK CEILING
Extract EVERY substantive detail. There is no upper limit. A short exchange may need 8-10 chunks; a long session might need 40-60+. The cost of one extra chunk is near zero; the cost of one lost detail is a future session where the user has to re-explain something. When in doubt, extract it.

## 6. DATE PREFIX
Every chunk's content starts with the date prefix supplied in the user message, e.g. "[May 24, 2026] ...". The user message tells you the exact prefix string — use it verbatim, including the trailing space.

## 7. CORRECTION HANDLING
When the conversation contains a correction (e.g. "actually it's port 5433, not 5432"), extract ONLY the corrected value. Discard the original.

## 8. DATA ECHO PREVENTION
Any content that previously appeared with the "[from knowledge base: ...]" tag has been stripped from your input. If you still see fragments tagged that way, do NOT re-extract them — they are recalled context, not new knowledge.

## 9. NEUTRAL FACTUAL TONE
"Decision: Use Clerk for auth" — not "We decided to use Clerk for auth". The chunks read like reference book entries, not narrative.

# Labels

Assign a unique label to every chunk you emit, kebab-case, descriptive: "postgres-decision", "redis-config", "next-steps", "sarah-frontend-lead". Pass 2 will reference these labels.

# topic_tags — REQUIRED, never empty

EVERY chunk must include at least 2 topic_tags. NEVER return topic_tags: []. Tags are lowercase, hyphenated, 1-3 words each, and capture the subject matter — not the chunk_type. Good tags: "database", "postgresql", "deployment", "authentication", "pricing", "kafka". Bad tags: "decision" (that's the type), "important" (meaningless), "general" (says nothing).

Aim for 2-4 tags per chunk. Use the most specific terms available in the conversation (proper nouns when they exist) plus the broad domain ("postgresql" + "database" + "architecture").

# session_summary

A DETAILED narrative, 1000-1500 tokens. Captures the complete arc of the session so someone reading ONLY this summary has near-complete context. Include:
- What the session set out to accomplish
- Approaches tried, considered, or discussed
- Why specific approaches were chosen or rejected (with specifics)
- What was actually built, changed, or configured (with specific details)
- Problems encountered and exactly how they were resolved
- Specific values, configurations, URLs, data points
- Links / external resources referenced
- Current state of whatever was being worked on
- What needs to happen next, open questions

SAFETY NET RULE: the session_summary MUST mention every proper noun, specific number, URL, file path, deadline, and person name from the conversation, even when they also appear in chunks. Server-side verification cross-checks the summary against the chunks; any detail not in the summary AND not in a chunk is permanently lost.

After writing the summary, re-scan it for category nouns where proper nouns exist and replace them. "A team member" → use the name. "The database" → use the specific database. "The deployment" → say where (Railway, Vercel, etc.).

BAD (too vague): "Worked on auth. Fixed some issues. Deployed to production."

GOOD: "Replaced legacy NextAuth with Clerk on api.contextcloud.pro after auth.middleware.ts kept throwing 'Invalid session token' on edge requests. Configured Clerk publicMetadata.plan to drive super-commit eligibility. Deployed to Railway Pro from the main branch at commit 8a877a0. Next: wire publicMetadata.plan into getUserPlan in superCommitService.ts."

# next_steps / open_questions

Each is an ARRAY of short, self-contained strings — one actionable item per entry for next_steps, one unresolved question per entry for open_questions. Empty arrays if none.

# SELF-VERIFICATION — REQUIRED FINAL PASS
Before returning, scan the conversation ONE MORE TIME with the mindset "what's specific":
- Names of people, tools, services, libraries
- Numbers: ports, versions, prices, dates, deadlines, counts, percentages
- URLs, file paths, repo locations, endpoints
- Environment variables, config keys, secret locations
- Decisions — even small ones like "let's keep the secondary CTA"
- Implementation specifics: what to change, where, how
- Ownership: who's responsible for what
- Deadlines and timelines
- Corrections: "actually it's X not Y"
- Operational context: deployment URLs, staging vs production, service accounts

For each item not already in a chunk, add a chunk (usually reference). This step typically adds 3-8 chunks to the initial extraction. If it adds zero, you likely missed something — review again.

# Output schema

Return EXACTLY this JSON shape — no extra fields, no markdown, no prose:

{
  "chunks": [
    {
      "content": "[<date prefix>] Decision: Use PostgreSQL over MongoDB ...",
      "chunk_type": "decision",
      "topic_tags": ["database", "postgresql", "architecture"],
      "topic_key": "primary-database",
      "label": "postgres-decision"
    },
    {
      "content": "[<date prefix>] Reference: API deployed at https://api.contextcloud.pro on Railway Pro",
      "chunk_type": "reference",
      "topic_tags": ["deployment", "url"],
      "label": "api-url-ref"
    }
  ],
  "session_summary": "...",
  "next_steps": ["Wire Clerk publicMetadata.plan into getUserPlan in superCommitService.ts"],
  "open_questions": ["Should free-tier users see super-commit eligibility 0/0 or hide the field entirely?"]
}

Omit topic_key on non-state/decision chunks. Every chunk must have a unique label.`;

interface Pass1Output {
  chunks: ExtractionChunk[];
  sessionSummary: string;
  nextSteps: string[];
  openQuestions: string[];
}

// ============================================
// Simplified Pass 1 prompt for retry path.
//
// The full Pass 1 prompt is ~200 lines and occasionally overwhelms
// gpt-4o-mini on edge-case conversations (empty/garbage input, very long
// tool-call noise the normalizer didn't strip, etc.) — the model returns
// malformed JSON or an empty chunks array. The simplified prompt drops the
// WRONG/RIGHT examples, the self-verification step, the topic_key topology
// guidance, and the volume rules. What stays: the six chunk types, JSON
// schema, date prefix, and the core specificity instruction. Trades quality
// for robustness, which is the right call when the alternative is permanent
// failure.
// ============================================
const PASS_1_SIMPLIFIED_SYSTEM_PROMPT = `You extract knowledge from AI-assisted conversations. Return ONLY valid JSON — no prose, no markdown fences.

Extract substantive facts as typed chunks. Preserve proper nouns, numbers, URLs, version strings, and configuration values verbatim — do NOT generalize. Attribute facts to the people named in the conversation.

Chunk types (use exactly these strings):
- "decision": A choice made, with rationale
- "finding":  Something discovered or learned
- "convention": A pattern, rule, or standard
- "state":    Current status of something
- "question": An open question
- "reference": Specific data: URL, env var, config value, pricing, ID

Each chunk's content starts with the date prefix supplied in the user message (verbatim, with the trailing space).

next_steps and open_questions are arrays of short strings (one item each). Empty arrays if none.

session_summary: a single paragraph (300-500 words) that mentions every proper noun, number, URL, and person name from the conversation.

Output JSON schema:
{
  "chunks": [
    {
      "content": "[<date>] Decision: ...",
      "chunk_type": "decision",
      "topic_tags": ["tag1", "tag2"],
      "label": "d1"
    }
  ],
  "session_summary": "...",
  "next_steps": ["..."],
  "open_questions": ["..."]
}

Every chunk must have at least 2 topic_tags and a unique short label.`;

function buildPass1UserMessage(text: string, datePrefix: string): string {
  return `Date prefix to use on every chunk content (verbatim, including the trailing space): "${datePrefix}"

Conversation to extract from:
---
${text}
---

Follow every rule in the system prompt. Return ONLY the JSON object.`;
}

async function runPass1(
  text: string,
  datePrefix: string,
  simplified = false
): Promise<Pass1Output> {
  const client = getOpenAI();
  const response = await client.chat.completions.create({
    model: EXTRACTION_MODEL,
    max_tokens: EXTRACTION_MAX_TOKENS,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: simplified
          ? PASS_1_SIMPLIFIED_SYSTEM_PROMPT
          : PASS_1_SYSTEM_PROMPT,
      },
      { role: "user", content: buildPass1UserMessage(text, datePrefix) },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "";
  return parsePass1(raw);
}

function parsePass1(raw: string): Pass1Output {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    console.error("[server-extraction] Pass 1 JSON parse failed:", e?.message);
    return { chunks: [], sessionSummary: "", nextSteps: [], openQuestions: [] };
  }

  const chunks: ExtractionChunk[] = [];
  if (Array.isArray(parsed.chunks)) {
    for (const c of parsed.chunks) {
      if (!c || typeof c.content !== "string" || typeof c.chunk_type !== "string") {
        continue;
      }
      // Context chunks come out of Pass 2, not Pass 1. Drop any "context" the
      // model might emit here as a safety net against schema drift.
      if (c.chunk_type === "context") continue;
      if (!isStructuredChunkType(c.chunk_type)) continue;
      chunks.push({
        content: c.content,
        chunk_type: c.chunk_type,
        topic_tags: Array.isArray(c.topic_tags) ? c.topic_tags : [],
        topic_key:
          (c.chunk_type === "state" || c.chunk_type === "decision") &&
          typeof c.topic_key === "string" &&
          c.topic_key.trim().length > 0
            ? c.topic_key
            : undefined,
        label:
          typeof c.label === "string" && c.label.trim().length > 0
            ? c.label
            : undefined,
      });
    }
  }

  return {
    chunks,
    sessionSummary:
      typeof parsed.session_summary === "string" ? parsed.session_summary : "",
    nextSteps: Array.isArray(parsed.next_steps)
      ? parsed.next_steps.filter((s: any) => typeof s === "string")
      : [],
    openQuestions: Array.isArray(parsed.open_questions)
      ? parsed.open_questions.filter((s: any) => typeof s === "string")
      : [],
  };
}

function isStructuredChunkType(t: string): t is Exclude<ExtractionChunkType, "context"> {
  return (
    t === "decision" ||
    t === "finding" ||
    t === "convention" ||
    t === "state" ||
    t === "question" ||
    t === "reference"
  );
}

// ============================================
// Topic-tag safety net
//
// gpt-4o-mini will occasionally return topic_tags: [] or a single tag despite
// the prompt rule. Empty tags hurt recall — the search path uses tags as one
// of its signals. This deterministic backfill mines the chunk content for
// plausible tags so we never emit a chunk with < 2 tags.
//
// Strategy: pull proper nouns, lowercased domain words, and a chunk-type
// fallback. Deterministic and cheap.
// ============================================

// Words that look "tag-like" — short, lowercased, no special chars.
// Common stopwords are filtered so we don't tag chunks with "the" or "with".
const TAG_STOPWORDS = new Set<string>([
  "the", "a", "an", "and", "or", "but", "for", "of", "in", "on", "at", "to",
  "with", "from", "by", "as", "is", "was", "are", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "should", "could", "may", "might", "can", "this", "that", "these", "those",
  "it", "its", "we", "us", "our", "you", "your", "they", "them", "their",
  "he", "she", "his", "her", "i", "me", "my", "if", "then", "else", "while",
  "when", "where", "what", "why", "how", "all", "any", "some", "most",
  "more", "less", "very", "too", "also", "just", "only", "not", "no",
  "yes", "ok", "okay", "user", "ai", "decision", "finding", "convention",
  "state", "question", "reference", "context", "session", "next", "step",
  "steps", "open", "questions",
]);

// Capitalised proper nouns. Crude but effective on our chunk format —
// "Decision: Use PostgreSQL ..." surfaces "PostgreSQL" as a tag.
const PROPER_NOUN_RE = /\b([A-Z][A-Za-z0-9]{2,}(?:[A-Z][a-z]+)?)\b/g;

function deriveTagsFromContent(content: string, chunkType: string): string[] {
  const tags = new Set<string>();

  // 1. Proper nouns from content (e.g. "PostgreSQL", "Railway", "ClickHouse").
  const proper = content.match(PROPER_NOUN_RE) ?? [];
  for (const word of proper) {
    const lower = word.toLowerCase();
    if (lower.length < 3) continue;
    if (TAG_STOPWORDS.has(lower)) continue;
    tags.add(lower);
    if (tags.size >= 3) break;
  }

  // 2. Lowercase tokens (e.g. "kafka", "redis", "deployment") if we still
  //    need more. Skip the date prefix the chunk starts with.
  if (tags.size < 2) {
    const stripped = content.replace(/^\[[^\]]+\]\s*/, "");
    const words = stripped.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [];
    for (const word of words) {
      if (TAG_STOPWORDS.has(word)) continue;
      tags.add(word);
      if (tags.size >= 3) break;
    }
  }

  // 3. Last-resort fallback: tag with the chunk_type's broad domain so the
  //    chunk at least carries SOMETHING. "knowledge" is generic but better
  //    than empty.
  if (tags.size < 2) {
    tags.add(chunkType);
    tags.add("knowledge");
  }

  return Array.from(tags).slice(0, 4);
}

/**
 * Walk a list of chunks; for any chunk with < 2 topic_tags, deterministically
 * derive tags from the chunk content. Logs a warning so we can track how
 * often the model is dropping tags.
 */
function backfillTopicTags(chunks: ExtractionChunk[]): void {
  let backfilled = 0;
  for (const c of chunks) {
    const current = Array.isArray(c.topic_tags) ? c.topic_tags : [];
    if (current.length >= 2) continue;
    const derived = deriveTagsFromContent(c.content, c.chunk_type);
    const merged = Array.from(new Set([...current, ...derived])).slice(0, 4);
    c.topic_tags = merged;
    backfilled++;
  }
  if (backfilled > 0) {
    console.warn(
      `[server-extraction] backfilled topic_tags on ${backfilled} chunk(s); model returned <2 tags`
    );
  }
}

// ============================================
// Pass 2: context chunks
// ============================================

const PASS_2_SYSTEM_PROMPT = `You are the second pass of a two-pass knowledge extractor. The first pass produced structured chunks (decisions, findings, etc.) from a conversation. Your job is to extract CONTEXT chunks — the supporting "why" and "how" behind those structured chunks.

# What context chunks capture

- Alternatives considered before a decision was made
- Tradeoffs discussed and reasoning paths
- Specific numbers, data points, metrics mentioned
- Problems encountered and how they were resolved
- Implementation details that didn't become formal conventions
- Debugging steps and workarounds found
- Background information that informed a decision
- Specific infrastructure / configuration details: domains, ports, CNAME records, env var names+values, polling intervals, thresholds, pricing, token counts, dimensions, error messages, account mappings
- URLs, links, documentation pages, GitHub issues
- Exact commands, code snippets, configuration values used or suggested
- Specific metrics, benchmarks, performance numbers
- Names of tools, libraries, services, platforms evaluated or used

What NOT to extract:
- Greetings, small talk, filler
- The AI's explanatory text (unless the user confirmed a specific technical detail in it)
- Repeated info already captured in a structured chunk from Pass 1
- Questions the user asked that were fully answered (the answer matters, not the question)

# Granularity

Each context chunk is 80-150 tokens and focused on EXACTLY ONE specific detail. If a chunk covers two distinct facts, split it. A chunk about "Redis configuration AND the DNS issue" must become two chunks. They can both link to the same parent.

Think of each context chunk as answering ONE specific future question:
- "What port is Redis running on?" → one chunk
- "What was the DNS propagation time?" → another chunk
- "What error did we hit with the CNAME?" → another chunk

# CRITICAL RULES — same specificity and attribution rules as Pass 1

- NEVER generalise. Keep proper nouns, numbers, URLs, paths, version strings, error messages verbatim.
- Preserve attribution (who said / decided / proposed).
- Capture operational context (repo paths, env vars, deployment URLs) as standalone chunks.
- Drop any content that was tagged "[from knowledge base: ...]" in the raw text — that is recalled context, not new knowledge.
- Each chunk's content starts with the date prefix supplied in the user message.

# Volume

Extract as many context chunks as the conversation warrants. A short 5-minute exchange might need 8-10 context chunks; a 30-minute deep session might need 40-60. There is no upper limit.

# Linking

The user message provides Pass 1's chunks with their labels. EVERY context chunk you emit must list one or more Pass 1 labels in related_to_labels. A context chunk can link to multiple parents if it spans topics.

If a context chunk cannot be reasonably linked to any Pass 1 chunk, drop it — the structured chunks are the spine. If you find context that has no spine, surface it as a finding or reference instead (but those belong in Pass 1, not here).

# Labels on YOUR chunks

Assign a unique label to every context chunk you emit: "ctx1", "ctx2", ... or descriptive like "redis-port-context". These will be used to resolve cross-links downstream.

# Output schema

Return EXACTLY this JSON shape — no extra fields, no markdown, no prose:

{
  "chunks": [
    {
      "content": "[<date prefix>] Considered MongoDB before settling on PostgreSQL because the schema is mostly relational; the team's existing Postgres expertise tipped the call.",
      "chunk_type": "context",
      "topic_tags": ["database", "alternatives"],
      "label": "ctx1",
      "related_to_labels": ["postgres-decision"]
    }
  ]
}

Every chunk must have chunk_type="context", a unique label, and a non-empty related_to_labels referencing Pass 1 labels. **topic_tags must contain at least 2 tags — never return topic_tags: []**. Use specific, descriptive, lowercase tags (e.g. "redis", "configuration", "ttl") — never just the chunk_type.`;

function buildPass2UserMessage(
  text: string,
  datePrefix: string,
  pass1: Pass1Output
): string {
  const structuredFormatted =
    pass1.chunks.length > 0
      ? pass1.chunks
          .map(
            (c) =>
              `- label="${c.label ?? "(missing)"}" type=${c.chunk_type} : ${c.content}`
          )
          .join("\n")
      : "(Pass 1 returned no structured chunks)";

  return `Date prefix to use on every chunk content (verbatim, including the trailing space): "${datePrefix}"

Pass 1 structured chunks (link your context chunks to these labels):
${structuredFormatted}

Conversation:
---
${text}
---

Return ONLY the JSON object with context chunks.`;
}

async function runPass2(
  text: string,
  datePrefix: string,
  pass1: Pass1Output
): Promise<ExtractionChunk[]> {
  // No point asking for context if Pass 1 produced nothing to link to.
  if (pass1.chunks.length === 0) return [];

  const client = getOpenAI();
  const response = await client.chat.completions.create({
    model: EXTRACTION_MODEL,
    max_tokens: EXTRACTION_MAX_TOKENS,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PASS_2_SYSTEM_PROMPT },
      { role: "user", content: buildPass2UserMessage(text, datePrefix, pass1) },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "";
  return parsePass2(raw, pass1);
}

function parsePass2(
  raw: string,
  pass1: Pass1Output
): ExtractionChunk[] {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    console.error("[server-extraction] Pass 2 JSON parse failed:", e?.message);
    return [];
  }
  if (!Array.isArray(parsed.chunks)) return [];

  // Pass 1 labels are the only valid link targets. Discard related_to_labels
  // entries that don't match — the model occasionally hallucinates a label.
  const validLabels = new Set(
    pass1.chunks
      .map((c) => c.label)
      .filter((l): l is string => typeof l === "string" && l.length > 0)
  );

  const out: ExtractionChunk[] = [];
  for (const c of parsed.chunks) {
    if (!c || typeof c.content !== "string") continue;
    if (c.chunk_type !== "context") continue;
    const linked = Array.isArray(c.related_to_labels)
      ? c.related_to_labels.filter(
          (l: any) => typeof l === "string" && validLabels.has(l)
        )
      : [];
    if (linked.length === 0) continue;
    out.push({
      content: c.content,
      chunk_type: "context",
      topic_tags: Array.isArray(c.topic_tags) ? c.topic_tags : [],
      label:
        typeof c.label === "string" && c.label.trim().length > 0
          ? c.label
          : undefined,
      related_to_labels: linked,
    });
  }
  return out;
}

// ============================================
// Post-process: deterministic entity coverage against raw text
// ============================================

/**
 * Scan the raw conversation text for proper nouns, URLs, numbers, and
 * technical identifiers; for any entity that doesn't surface anywhere in the
 * extracted chunks or session_summary, log it. The commit pipeline runs its
 * own coverage check against the summary later (entityExtractor.checkCoverage
 * in mcp.ts), so this is a logging-level safety net — it doesn't modify
 * the chunk list, only surfaces what the LLM dropped from the summary.
 */
export function postProcess(
  rawText: string,
  chunks: ExtractionChunk[],
  sessionSummary: string
): { missedEntities: ExtractedEntity[] } {
  const rawEntities = extractEntities(rawText);
  if (rawEntities.length === 0) return { missedEntities: [] };

  const haystack = (
    sessionSummary +
    "\n" +
    chunks.map((c) => c.content).join("\n")
  ).toLowerCase();

  const missed: ExtractedEntity[] = [];
  for (const e of rawEntities) {
    if (!haystack.includes(e.text.toLowerCase())) {
      missed.push(e);
    }
  }

  if (missed.length > 0) {
    console.warn(
      `[server-extraction] post-process: ${missed.length}/${rawEntities.length} raw-text entities missing from chunks+summary`
    );
  }
  return { missedEntities: missed };
}

// ============================================
// Orchestrator
// ============================================

/**
 * Format today's date as "May 24, 2026" — matches the prefix mcp.ts puts on
 * chunks at commit time so the LLM produces content that doesn't need to
 * be re-dated downstream.
 */
function formatDatePrefix(d: Date = new Date()): string {
  return `[${d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })}] `;
}

/**
 * Run the full server-side extraction: normalize, two-pass LLM extraction,
 * deterministic post-process. Returns the chunks + summary in the exact shape
 * jobService hands to the commit pipeline.
 */
export async function extractFromConversation(
  params: ExtractFromConversationParams
): Promise<ExtractionResult> {
  const { conversationText, toolUsed, simplified = false } = params;

  if (!isExtractionConfigured()) {
    throw new Error(
      "OPENAI_API_KEY is not configured — server-side extraction cannot run"
    );
  }

  const extractionStart = Date.now();
  let t0: number;

  // ---- Normalization ----
  t0 = Date.now();
  const normalized = normalizeConversation(conversationText, toolUsed);
  const normalization_ms = Date.now() - t0;

  const datePrefix = formatDatePrefix();

  console.log(
    `[server-extraction] start  tool=${toolUsed ?? "?"}  raw_chars=${conversationText.length}  normalized_chars=${normalized.length}  simplified=${simplified}`
  );

  // ---- Pass 1 ----
  let pass1: Pass1Output;
  t0 = Date.now();
  try {
    pass1 = await runPass1(normalized, datePrefix, simplified);
  } catch (err: any) {
    console.error("[server-extraction] Pass 1 failed:", err?.message ?? err);
    throw new Error(`Pass 1 extraction failed: ${err?.message ?? "unknown"}`);
  }
  const pass1_ms = Date.now() - t0;

  // ---- Pass 2 ----
  // Pass 2 (context chunks) and the postProcess entity audit are skipped in
  // simplified mode — they're quality-of-life additions that aren't worth
  // the LLM round-trip when we're already on the retry path.
  let pass2Chunks: ExtractionChunk[] = [];
  t0 = Date.now();
  if (!simplified) {
    try {
      pass2Chunks = await runPass2(normalized, datePrefix, pass1);
    } catch (err: any) {
      // Pass 2 is best-effort. A failure here drops context chunks but does
      // NOT lose the structured chunks — those are the spine of the commit.
      console.warn(
        "[server-extraction] Pass 2 failed; continuing with Pass 1 chunks only:",
        err?.message ?? err
      );
    }
  }
  const pass2_ms = Date.now() - t0;

  const allChunks: ExtractionChunk[] = [...pass1.chunks, ...pass2Chunks];

  // ---- Backfill topic tags ----
  t0 = Date.now();
  backfillTopicTags(allChunks);
  const backfill_tags_ms = Date.now() - t0;

  // ---- Post-process ----
  t0 = Date.now();
  if (!simplified) {
    postProcess(normalized, allChunks, pass1.sessionSummary);
  }
  const postprocess_ms = Date.now() - t0;

  const total_extraction_ms = Date.now() - extractionStart;

  console.log(
    `[server-extraction] done   pass1_chunks=${pass1.chunks.length}  context_chunks=${pass2Chunks.length}  summary_chars=${pass1.sessionSummary.length}  next_steps=${pass1.nextSteps.length}  open_questions=${pass1.openQuestions.length}  simplified=${simplified}`
  );

  const timings: ExtractionTimings = {
    normalization_ms,
    pass1_ms,
    pass1_chunks: pass1.chunks.length,
    pass2_ms,
    pass2_chunks: pass2Chunks.length,
    postprocess_ms,
    backfill_tags_ms,
    total_extraction_ms,
  };

  return {
    chunks: allChunks,
    sessionSummary: pass1.sessionSummary,
    nextSteps: pass1.nextSteps,
    openQuestions: pass1.openQuestions,
    model: EXTRACTION_MODEL,
    passes: pass2Chunks.length > 0 ? 2 : 1,
    timings,
  };
}
