// Super commit eligibility + credit consumption + LLM verification.
//
// Redis port of the reference's superCommitService.ts. The gating semantics
// and BOTH LLM passes (verify + re-extract) are byte-for-byte identical; only
// the usage accounting moved from the Postgres `super_commit_usage` table +
// increment_super_commit_usage RPC to a per-user-per-day Redis counter
// (superCommitRepo, INCR). The AI tool description never mentions super
// commits — the server decides silently.

import OpenAI from "openai";
import { getRedis } from "../lib/redis.js";
import { getUsedToday, incrementUsage } from "../lib/superCommitRepo.js";

const PLAN_LIMITS = {
  free: 5,
  pro: 100,
  team: 100,
} as const;

export type Plan = keyof typeof PLAN_LIMITS;

export interface SuperCommitEligibility {
  eligible: boolean;
  plan: Plan;
  used_today: number;
  limit: number;
  remaining: number;
}

/**
 * Resolve the user's plan. Stub — everyone is on `free` until Clerk
 * publicMetadata.plan / billing lands (phase 7+), matching the reference.
 */
export async function getUserPlan(_userId: string): Promise<Plan> {
  return "free";
}

/**
 * Check whether `userId` has any super-commit credits left today. Always
 * succeeds — on any lookup failure we degrade to "not eligible" so the
 * standard commit path runs unobstructed.
 */
export async function checkEligibility(userId: string): Promise<SuperCommitEligibility> {
  const plan = await getUserPlan(userId);
  const limit = PLAN_LIMITS[plan];

  try {
    const usedToday = await getUsedToday(getRedis(), userId);
    const remaining = Math.max(0, limit - usedToday);
    return { eligible: remaining > 0, plan, used_today: usedToday, limit, remaining };
  } catch (err: any) {
    console.error(
      `[super-commit] eligibility lookup failed for user=${userId}:`,
      err?.message ?? err
    );
    return { eligible: false, plan, used_today: 0, limit, remaining: 0 };
  }
}

/**
 * Atomically increment today's usage counter for `userId`. Backed by Redis
 * INCR so concurrent commits from the same user can't race past the limit.
 */
export async function consumeCredit(userId: string): Promise<void> {
  await incrementUsage(getRedis(), userId);
}

// ============================================
// LLM verification + re-extraction (verbatim from the reference)
// ============================================

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPER_COMMIT_MODEL = process.env.SUPER_COMMIT_MODEL || "gpt-4o-mini";
const SUPER_COMMIT_MAX_TOKENS = 4096;

export const VERIFICATION_TIMEOUT_MS = 10_000;
export const REEXTRACTION_TIMEOUT_MS = 8_000;

export const VERIFICATION_RECALL_FETCH = 30;
export const VERIFICATION_CONTEXT_LIMIT = 20;
export const VERIFICATION_QUERY_CHARS = 500;

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured for super commits");
  }
  if (!openai) openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  return openai;
}

export function isSuperCommitConfigured(): boolean {
  return !!OPENAI_API_KEY;
}

export interface VerifiableChunk {
  content: string;
  chunk_type: string;
}

export interface ExistingChunkRef {
  id: string;
  content: string;
  topic_key?: string | null;
}

export interface VerificationGap {
  description: string;
  summary_quote: string;
  severity: "high" | "medium" | "low";
}

export interface VerificationConflict {
  new_chunk_content: string;
  existing_chunk_id: string;
  existing_chunk_content: string;
  conflict_type: "update" | "contradiction";
}

export interface VerificationQualityIssue {
  chunk_content: string;
  issue: string;
  summary_has: string;
  chunk_has: string;
}

export interface VerificationResult {
  gaps: VerificationGap[];
  conflicts: VerificationConflict[];
  quality_issues: VerificationQualityIssue[];
}

export interface ReExtractedChunk {
  content: string;
  chunk_type: "decision" | "state" | "reference" | "finding" | "context";
  topic_tags: string[];
  topic_key?: string;
}

async function callLLM(
  systemPrompt: string,
  userMessage: string,
  options: { timeoutMs?: number } = {}
): Promise<string> {
  const client = getOpenAI();
  const response = await client.chat.completions.create(
    {
      model: SUPER_COMMIT_MODEL,
      max_tokens: SUPER_COMMIT_MAX_TOKENS,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    },
    options.timeoutMs ? { timeout: options.timeoutMs } : undefined
  );
  return response.choices[0]?.message?.content ?? "";
}

function parseVerificationResponse(raw: string): VerificationResult {
  try {
    const parsed = JSON.parse(raw);
    return {
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
      conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
      quality_issues: Array.isArray(parsed.quality_issues) ? parsed.quality_issues : [],
    };
  } catch (e: any) {
    console.error("[super-commit] verification parse failure:", e?.message);
    return { gaps: [], conflicts: [], quality_issues: [] };
  }
}

function parseReExtractionResponse(raw: string): ReExtractedChunk[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.chunks)) return [];
    return parsed.chunks
      .filter(
        (c: any) =>
          c && typeof c.content === "string" && typeof c.chunk_type === "string"
      )
      .map((c: any) => ({
        content: c.content,
        chunk_type: c.chunk_type,
        topic_tags: Array.isArray(c.topic_tags) ? c.topic_tags : [],
        topic_key:
          typeof c.topic_key === "string" && c.topic_key.trim().length > 0
            ? c.topic_key
            : undefined,
      }));
  } catch (e: any) {
    console.error("[super-commit] re-extraction parse failure:", e?.message);
    return [];
  }
}

const VERIFICATION_SYSTEM_PROMPT =
  "You are a quality-assurance system for a knowledge base. Your job is to find gaps, conflicts, and quality issues in extracted knowledge chunks. Be precise and conservative — only flag genuine issues, not stylistic differences.";

function buildVerificationUserPrompt(
  chunks: VerifiableChunk[],
  sessionSummary: string,
  existingSimilarChunks: ExistingChunkRef[]
): string {
  const chunksFormatted = chunks
    .map((c, i) => `${i + 1}. [${c.chunk_type}] ${c.content}`)
    .join("\n");

  const existingFormatted =
    existingSimilarChunks.length > 0
      ? existingSimilarChunks
          .map(
            (c, i) =>
              `${i + 1}. id=${c.id}${c.topic_key ? ` topic_key="${c.topic_key}"` : ""}\n   ${c.content}`
          )
          .join("\n")
      : "(none)";

  return `SESSION SUMMARY (ground truth — this is what happened in the conversation):
${sessionSummary}

EXTRACTED CHUNKS (what was captured):
${chunksFormatted || "(none)"}

EXISTING KNOWLEDGE BASE CHUNKS (potentially related — check for conflicts):
${existingFormatted}

Find four types of issues:

1. GAPS — Facts, decisions, implementation details, or specific instructions mentioned in the session summary that are NOT adequately covered by any extracted chunk. Focus especially on:
   - Specific names, numbers, URLs, or configuration values
   - Implementation details (what to change, where, how)
   - Decisions about what to keep, remove, or modify
   - Action items or next steps mentioned in passing

   For each gap, quote the exact sentence from the summary.

2. CONFLICTS — For each extracted chunk, check whether any existing chunk describes the same subject (same thing, same property) but holds a different value. If yes, flag it with conflict_type="update" — even if the new chunk uses words like "updated", "now", "changed". The self-describing phrasing does NOT exempt it; the existing chunk still says the old value and needs to be superseded. Only skip when the existing chunk overlaps topically but describes a different subject or property (e.g. both about the navbar, but one about colors and the other about links — not a conflict).

3. QUALITY ISSUES — Any extracted chunk where a specific detail from the summary has been generalized or abstracted. Example: summary says "PostgreSQL on port 5432" but chunk says "configured the database."

4. OPERATIONAL CONTEXT — File paths, repo locations, deployment URLs, team member names, environment configurations, tool references, or service account details mentioned anywhere in the session summary that don't have their own dedicated chunk. These foundational facts are the most commonly lost across sessions.

Respond ONLY with a JSON object of the following shape:
{
  "gaps": [
    {
      "description": "Badge text replacement not captured",
      "summary_quote": "Replace EARLY ACCESS badge with 'Context engineering for AI-native builders'",
      "severity": "high"
    }
  ],
  "conflicts": [
    {
      "new_chunk_content": "Decision: Use PostgreSQL for primary database",
      "existing_chunk_id": "chunk-uuid-here",
      "existing_chunk_content": "Decision: Use MongoDB for primary database",
      "conflict_type": "update"
    }
  ],
  "quality_issues": [
    {
      "chunk_content": "Configured the database connection",
      "issue": "Generalized specific database name and port",
      "summary_has": "PostgreSQL on port 5432 at db.railway.internal",
      "chunk_has": "the database connection"
    }
  ]
}

If no issues found in a category, return an empty array for it.`;
}

const REEXTRACTION_SYSTEM_PROMPT =
  "You extract specific knowledge chunks that were missed during initial extraction. The session summary is the ground truth. Use EXACT specific details — names, numbers, URLs, configuration values — never generalise or abstract.";

function buildReExtractionUserPrompt(
  gaps: VerificationGap[],
  sessionSummary: string,
  datePrefix: string
): string {
  const gapsFormatted = gaps
    .map((g, i) => `${i + 1}. ${g.description}\n   Summary quote: "${g.summary_quote}"`)
    .join("\n");

  return `SESSION SUMMARY:
${sessionSummary}

MISSED DETAILS (each needs its own chunk):
${gapsFormatted}

For each missed detail, produce a properly structured knowledge chunk.
Each chunk must be self-contained and specific.

Rules:
- Use the EXACT specific details from the summary (names, numbers, URLs)
- Never generalize or abstract
- Prepend "${datePrefix}" to the content field of every chunk
- Choose the most appropriate chunk_type:
  - "decision" for choices that were made
  - "state" for current status or configuration
  - "reference" for specific data points, URLs, config values
  - "finding" for things learned / discovered
  - "context" for reasoning, alternatives, or supporting detail
- For state/decision chunks with single-current-value semantics, include a topic_key (kebab-case, 2-5 words)
- Include relevant topic_tags (2-4 tags)

Respond ONLY with a JSON object of the following shape:
{
  "chunks": [
    {
      "content": "${datePrefix}Badge text: 'Context engineering for AI-native builders' replacing the EARLY ACCESS badge in the hero section",
      "chunk_type": "decision",
      "topic_tags": ["landing-page", "hero", "badge"],
      "topic_key": "hero-badge-text"
    }
  ]
}`;
}

/**
 * LLM Call 1 — verify completeness, detect conflicts, flag quality issues.
 */
export async function verifyCommit(
  chunks: VerifiableChunk[],
  sessionSummary: string,
  existingSimilarChunks: ExistingChunkRef[],
  options: { timeoutMs?: number } = {}
): Promise<VerificationResult> {
  const raw = await callLLM(
    VERIFICATION_SYSTEM_PROMPT,
    buildVerificationUserPrompt(chunks, sessionSummary, existingSimilarChunks),
    options
  );
  return parseVerificationResponse(raw);
}

/**
 * LLM Call 2 — re-extract proper structured chunks for the gaps Call 1 found.
 */
export async function reExtractGaps(
  gaps: VerificationGap[],
  sessionSummary: string,
  datePrefix: string,
  options: { timeoutMs?: number } = {}
): Promise<ReExtractedChunk[]> {
  if (gaps.length === 0) return [];
  const raw = await callLLM(
    REEXTRACTION_SYSTEM_PROMPT,
    buildReExtractionUserPrompt(gaps, sessionSummary, datePrefix),
    options
  );
  return parseReExtractionResponse(raw);
}
