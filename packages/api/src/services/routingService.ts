// Server-side semantic routing for KB selection (Redis port).
//
// Three-tier cascade for commit routing:
//   Tier 1: Fast heuristics (explicit KB, name match, short-text → most recent)
//   Tier 2: Embedding similarity + BM25 entity overlap, margin check
//   Tier 3: GPT-4o-mini LLM fallback for ambiguous/no-match cases
//
// Search routing uses embedding + entity overlap for KB selection.
// Living descriptions auto-regenerate after each commit.
//
// The reference ran Tier 2 against the match_knowledge_bases Postgres RPC and
// entity overlap against a content_tsv text search. Here both become
// RediSearch queries: KNN over idx:kbs.description_embedding and a BM25 count
// over idx:chunks.content. The cascade logic, thresholds, and margins are
// byte-for-byte identical to the reference so routing decisions don't drift.

import OpenAI from "openai";
import { getRedis } from "../lib/redis.js";
import { generateEmbedding } from "./embeddingService.js";
import * as kbRepo from "../lib/kbRepo.js";
import * as chunkRepo from "../lib/chunkRepo.js";
import * as workspaceRepo from "../lib/workspaceRepo.js";
import * as sessionRepo from "../lib/sessionRepo.js";

// ============================================
// OpenAI client
// ============================================

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ROUTING_MODEL = "gpt-4o-mini";

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured for routing service");
  }
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
  return openaiClient;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================
// Types
// ============================================

export interface RouteCommitResult {
  kbId: string;
  kbName: string;
  wasCreated: boolean;
  confidence: number;
  method: "explicit" | "short-text" | "name-match" | "semantic" | "llm-fallback";
  tier: 1 | 2 | 3;
  margin?: number;
  entityOverlap?: number;
}

interface KbCandidate {
  id: string;
  name: string;
  description: string | null;
}

// ============================================
// Entity Overlap (BM25 keyword signal)
// ============================================

/**
 * Extract distinctive terms from text: proper nouns, tech terms, numbers,
 * URLs — anything that's a strong keyword signal for BM25.
 */
function extractDistinctiveTerms(text: string): string[] {
  const words = text.split(/\s+/);
  const terms: string[] = [];
  const seen = new Set<string>();

  for (const word of words) {
    const cleaned = word.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");
    if (!cleaned || cleaned.length < 2) continue;
    const lower = cleaned.toLowerCase();
    if (seen.has(lower)) continue;

    const isProperNoun = /^[A-Z][a-z]/.test(cleaned) && cleaned.length > 2;
    const hasDigits = /\d/.test(cleaned);
    const isDotted = /\./.test(cleaned); // URLs, domains
    const isLong = cleaned.length > 8; // technical terms
    const isAllCaps = /^[A-Z]{2,}$/.test(cleaned); // acronyms

    if (isProperNoun || hasDigits || isDotted || isLong || isAllCaps) {
      terms.push(cleaned);
      seen.add(lower);
    }
  }

  // Also grab quoted phrases
  const quoted = text.match(/"([^"]+)"/g);
  if (quoted) {
    for (const q of quoted) {
      const phrase = q.replace(/"/g, "").trim();
      if (phrase.length > 2 && !seen.has(phrase.toLowerCase())) {
        terms.push(phrase);
        seen.add(phrase.toLowerCase());
      }
    }
  }

  return terms.slice(0, 10);
}

/**
 * Compute entity overlap between text and a KB's existing content using BM25.
 * Returns 0.0-1.0: how many of the text's distinctive terms appear in the KB.
 */
export async function computeEntityOverlap(
  text: string,
  kbId: string
): Promise<number> {
  const terms = extractDistinctiveTerms(text);
  if (terms.length === 0) return 0;

  const redis = getRedis();
  const count = await chunkRepo.countActiveByText(redis, kbId, terms);
  return Math.min(1.0, count / 5);
}

// ============================================
// Tier 1: Fast Heuristics
// ============================================

async function tier1Heuristics(params: {
  providedKbId?: string;
  providedKbName?: string;
  sessionSummary: string;
  userId: string;
  mostRecentKbId?: string;
}): Promise<{
  kbId: string;
  kbName: string;
  confidence: number;
  method: "explicit" | "short-text" | "name-match";
} | null> {
  const redis = getRedis();

  // 1. Explicit KB ID
  if (params.providedKbId && UUID_RE.test(params.providedKbId)) {
    const kb = await kbRepo.getKb(redis, params.providedKbId);
    if (kb) {
      return { kbId: kb.id, kbName: kb.name, confidence: 1.0, method: "explicit" };
    }
  }

  // 2. Explicit KB name
  if (params.providedKbName) {
    const kb = await lookupKbByName(params.providedKbName, params.userId);
    if (kb) {
      return { kbId: kb.id, kbName: kb.name, confidence: 0.95, method: "name-match" };
    }
    // Name not found — don't return null yet, could create in Tier 3
  }

  // 3. Short/generic content → route to most recent KB
  // Only fires for truly terse content (< 6 words) — things like
  // "fix the bug", "call dentist", "meeting at 3pm". Even a single
  // sentence like "Configuring React hooks for state management"
  // has enough semantic signal for Tier 2 embedding routing.
  const wordCount = params.sessionSummary.split(/\s+/).length;
  if (wordCount < 6 && params.mostRecentKbId) {
    const kb = await kbRepo.getKb(redis, params.mostRecentKbId);
    if (kb) {
      return { kbId: kb.id, kbName: kb.name, confidence: 0.7, method: "short-text" };
    }
  }

  return null;
}

// ============================================
// Tier 2: Embedding + Entity Overlap
// ============================================

async function tier2Semantic(params: {
  sessionSummary: string;
  userId: string;
  summaryEmbedding: number[];
}): Promise<
  | { kbId: string; kbName: string; confidence: number; method: "semantic"; margin: number; entityOverlap: number }
  | "ambiguous"
  | "no-match"
> {
  const redis = getRedis();
  const userWsIds = await workspaceRepo.getUserWorkspaceIds(redis, params.userId);
  const matches = await kbRepo.matchKnowledgeBases(redis, params.summaryEmbedding, userWsIds, 0.3, 5);
  if (matches.length === 0) return "no-match";

  // Enrich top 3 candidates with entity overlap (parallel)
  const enriched = await Promise.all(
    matches.slice(0, 3).map(async (kb) => {
      const entityScore = await computeEntityOverlap(params.sessionSummary, kb.kb_id);
      const combinedScore = 0.7 * kb.similarity + 0.3 * entityScore;
      return { ...kb, entityScore, combinedScore };
    })
  );

  enriched.sort((a, b) => b.combinedScore - a.combinedScore);

  const top = enriched[0];
  const second = enriched[1];
  const margin = second ? top.combinedScore - second.combinedScore : 1.0;

  // Decision gates
  if (top.combinedScore > 0.75) {
    return {
      kbId: top.kb_id,
      kbName: top.kb_name,
      confidence: top.combinedScore,
      method: "semantic",
      margin,
      entityOverlap: top.entityScore,
    };
  }

  if (top.combinedScore > 0.5 && margin > 0.1) {
    return {
      kbId: top.kb_id,
      kbName: top.kb_name,
      confidence: top.combinedScore,
      method: "semantic",
      margin,
      entityOverlap: top.entityScore,
    };
  }

  if (top.combinedScore > 0.5 && margin <= 0.05) {
    // Virtually tied — ambiguous, escalate to LLM
    return "ambiguous";
  }

  // Accept borderline matches (0.25-0.5) if there's any margin.
  // text-embedding-3-small cosine similarities land lower than
  // intuition suggests — 0.25+ with margin is a valid match when
  // the alternative is an expensive Tier 3 LLM call.
  if (top.combinedScore > 0.24 && margin > 0.02) {
    return {
      kbId: top.kb_id,
      kbName: top.kb_name,
      confidence: top.combinedScore,
      method: "semantic",
      margin,
      entityOverlap: top.entityScore,
    };
  }

  return "no-match";
}

// ============================================
// Tier 3: LLM Fallback
// ============================================

async function tier3LlmFallback(params: {
  sessionSummary: string;
  userId: string;
  kbCandidates: KbCandidate[];
  providedKbName?: string;
}): Promise<{
  kbId: string;
  kbName: string;
  confidence: number;
  method: "llm-fallback";
  wasCreated: boolean;
}> {
  const kbList = params.kbCandidates
    .slice(0, 50)
    .map((kb, i) => `${i + 1}. "${kb.name}" — ${kb.description || "No description"}`)
    .join("\n");

  const prompt = `You are a knowledge base router. Given a conversation summary and a list of existing knowledge bases, decide where to route this conversation.

CONVERSATION SUMMARY:
${params.sessionSummary.substring(0, 500)}

EXISTING KNOWLEDGE BASES:
${kbList}

RULES:
- If the conversation clearly belongs to one of the existing KBs, respond with just the KB number (e.g., "3")
- If the conversation spans multiple KBs, pick the MOST relevant one
- If the conversation genuinely doesn't fit ANY existing KB, respond with "NEW: [suggested name]"
- Err toward matching an existing KB. Only say NEW if the topic is truly distinct from everything listed.

RESPOND WITH ONLY THE KB NUMBER OR "NEW: [name]". Nothing else.`;

  let result = "";
  try {
    const client = getOpenAI();
    const response = await client.chat.completions.create({
      model: ROUTING_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 30,
    });
    result = response.choices[0]?.message?.content?.trim() ?? "";
  } catch (err: any) {
    console.error("[routing] Tier 3 LLM call failed:", err?.message);
    // Fall back to most recent KB
    const mostRecent = await getMostRecentKb(params.userId);
    if (mostRecent) {
      return { kbId: mostRecent.id, kbName: mostRecent.name, confidence: 0.4, method: "llm-fallback", wasCreated: false };
    }
  }

  // Parse "NEW: ..." response
  if (result.startsWith("NEW:")) {
    const suggestedName = result.replace("NEW:", "").trim();

    // Anti-sprawl: check name similarity against existing KBs
    const collision = await checkNameSimilarity(suggestedName, params.kbCandidates);
    if (collision) {
      return { kbId: collision.id, kbName: collision.name, confidence: 0.6, method: "llm-fallback", wasCreated: false };
    }

    // Anti-sprawl: don't create if content is too generic (< 100 words)
    const wordCount = params.sessionSummary.split(/\s+/).length;
    if (wordCount < 100) {
      const mostRecent = await getMostRecentKb(params.userId);
      if (mostRecent) {
        return { kbId: mostRecent.id, kbName: mostRecent.name, confidence: 0.5, method: "llm-fallback", wasCreated: false };
      }
    }

    const kbName = params.providedKbName || suggestedName;
    const embedding = await generateEmbedding(params.sessionSummary);
    const newKb = await createKb(kbName, params.sessionSummary, embedding, params.userId);
    return { kbId: newKb.id, kbName: newKb.name, confidence: 0.8, method: "llm-fallback", wasCreated: true };
  }

  // Parse KB number
  const kbIndex = parseInt(result) - 1;
  if (kbIndex >= 0 && kbIndex < params.kbCandidates.length) {
    const picked = params.kbCandidates[kbIndex];
    return { kbId: picked.id, kbName: picked.name, confidence: 0.85, method: "llm-fallback", wasCreated: false };
  }

  // Couldn't parse — fall back to most recent KB
  const mostRecent = await getMostRecentKb(params.userId);
  if (mostRecent) {
    return { kbId: mostRecent.id, kbName: mostRecent.name, confidence: 0.4, method: "llm-fallback", wasCreated: false };
  }

  // Absolute last resort — create new KB
  const embedding = await generateEmbedding(params.sessionSummary);
  const newKb = await createKb(
    params.providedKbName || "Untitled Knowledge Base",
    params.sessionSummary,
    embedding,
    params.userId
  );
  return { kbId: newKb.id, kbName: newKb.name, confidence: 0.3, method: "llm-fallback", wasCreated: true };
}

// ============================================
// routeCommit — Three-Tier Orchestrator
// ============================================

/**
 * Determine which KB a commit should land in using a three-tier cascade:
 *   Tier 1: Fast heuristics (explicit KB, name match, short-text)
 *   Tier 2: Embedding + entity overlap with margin check
 *   Tier 3: LLM fallback for ambiguous/no-match cases
 */
export async function routeCommit(
  sessionSummary: string,
  userId: string,
  providedKbId?: string,
  providedKbName?: string
): Promise<RouteCommitResult> {
  const mostRecentKb = await getMostRecentKb(userId);

  // ── Tier 1: Fast heuristics ──
  const t1 = await tier1Heuristics({
    providedKbId,
    providedKbName: providedKbName && !providedKbId ? providedKbName : undefined,
    sessionSummary,
    userId,
    mostRecentKbId: mostRecentKb?.id,
  });

  if (t1) {
    console.log(
      `[routing] ${JSON.stringify({ tier: 1, method: t1.method, confidence: t1.confidence, kbId: t1.kbId })}`
    );
    return { ...t1, wasCreated: false, tier: 1 };
  }

  // ── Tier 2: Embedding + entity overlap ──
  const embedding = await generateEmbedding(sessionSummary);
  const t2 = await tier2Semantic({ sessionSummary, userId, summaryEmbedding: embedding });

  if (t2 !== "ambiguous" && t2 !== "no-match") {
    console.log(
      `[routing] ${JSON.stringify({ tier: 2, method: t2.method, confidence: +t2.confidence.toFixed(3), margin: +t2.margin.toFixed(3), entityOverlap: +t2.entityOverlap.toFixed(3), kbId: t2.kbId })}`
    );
    return { ...t2, wasCreated: false, tier: 2 };
  }

  console.log(`[routing] Tier 2 result: ${t2}, escalating to Tier 3`);

  // ── Tier 3: LLM fallback ──
  const allKbs = await getUserKbs(userId);
  const t3 = await tier3LlmFallback({
    sessionSummary,
    userId,
    kbCandidates: allKbs,
    providedKbName,
  });

  console.log(
    `[routing] ${JSON.stringify({ tier: 3, method: t3.method, confidence: t3.confidence, created: t3.wasCreated, kbId: t3.kbId })}`
  );
  return { ...t3, tier: 3 };
}

// ============================================
// routeSearch — Embedding + Entity Overlap
// ============================================

/**
 * Determine which KBs to search. Uses embedding similarity enriched with
 * entity overlap for more accurate KB selection.
 */
export async function routeSearch(
  query: string,
  userId: string,
  providedKbIds?: string[]
): Promise<string[]> {
  if (providedKbIds && providedKbIds.length > 0) {
    return providedKbIds;
  }

  const redis = getRedis();
  const queryEmbedding = await generateEmbedding(query);
  const userWsIds = await workspaceRepo.getUserWorkspaceIds(redis, userId);
  const matches = await kbRepo.matchKnowledgeBases(redis, queryEmbedding, userWsIds, 0.2, 10);

  // Enrich top 5 candidates with entity overlap
  const enriched = await Promise.all(
    matches.slice(0, 5).map(async (kb) => {
      const entityScore = await computeEntityOverlap(query, kb.kb_id);
      return { ...kb, combinedScore: 0.7 * kb.similarity + 0.3 * entityScore };
    })
  );

  enriched.sort((a, b) => b.combinedScore - a.combinedScore);

  let selectedKbs = enriched
    .filter((kb) => kb.similarity > 0.2)
    .map((kb) => kb.kb_id);

  // Pad with recently updated KBs if fewer than 3
  if (selectedKbs.length < 3) {
    const recentKbs = await getRecentlyUpdatedKbs(userId, 5);
    const existingIds = new Set(selectedKbs);
    for (const kb of recentKbs) {
      if (!existingIds.has(kb.id)) {
        selectedKbs.push(kb.id);
        existingIds.add(kb.id);
      }
      if (selectedKbs.length >= 3) break;
    }
  }

  console.log(`[routing] search routed to ${selectedKbs.length} KB(s)`);
  return selectedKbs.slice(0, 5);
}

// ============================================
// updateKbDescription
// ============================================

export async function updateKbDescription(kbId: string): Promise<void> {
  try {
    const redis = getRedis();
    const summaryTextsArr = await chunkRepo.getRecentContentsByType(redis, kbId, "session_summary", 5);
    const diverseChunks = await chunkRepo.getRecentContentsExcludingType(redis, kbId, "session_summary", 10);

    const summaryTexts = summaryTextsArr.join("\n\n");
    const chunkTexts = diverseChunks.map((c) => `[${c.chunk_type}] ${c.content}`).join("\n");

    if (!summaryTexts && !chunkTexts) return;

    const client = getOpenAI();
    const response = await client.chat.completions.create({
      model: ROUTING_MODEL,
      max_tokens: 200,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Generate a 2-3 sentence description of this knowledge base based on its contents. Be specific about the topics, technologies, and domains covered. Return ONLY the description text, no formatting.",
        },
        {
          role: "user",
          content: `Recent session summaries:\n${summaryTexts || "(none)"}\n\nSample chunks:\n${chunkTexts || "(none)"}`,
        },
      ],
    });

    const newDescription = response.choices[0]?.message?.content?.trim() ?? "";
    if (!newDescription) return;

    const descriptionEmbedding = await generateEmbedding(newDescription);

    await kbRepo.updateKb(redis, kbId, { auto_description: newDescription });
    await kbRepo.setDescriptionEmbedding(redis, kbId, descriptionEmbedding);

    console.log(`[routing] updated description for kb=${kbId}: "${newDescription.slice(0, 80)}..."`);
  } catch (err: any) {
    console.error(`[routing] updateKbDescription failed for kb=${kbId}:`, err?.message ?? err);
  }
}

// ============================================
// backfillKbEmbeddings
// ============================================

export async function backfillKbEmbeddings(userId: string): Promise<number> {
  const redis = getRedis();
  const userWsIds = await workspaceRepo.getUserWorkspaceIds(redis, userId);
  if (userWsIds.length === 0) return 0;

  const kbs = await kbRepo.getKbsByWorkspaces(redis, userWsIds);
  let updated = 0;
  for (const kb of kbs) {
    try {
      if (await kbRepo.hasDescriptionEmbedding(redis, kb.id)) continue;
      if (kb.description && kb.description.trim().length > 0) {
        const embedding = await generateEmbedding(kb.description);
        await kbRepo.setDescriptionEmbedding(redis, kb.id, embedding);
        updated++;
      } else if (kb.chunk_count > 0) {
        await updateKbDescription(kb.id);
        updated++;
      }
    } catch (err: any) {
      console.error(`[routing] backfill failed for kb=${kb.id} (${kb.name}):`, err?.message ?? err);
    }
  }

  console.log(`[routing] backfill completed: ${updated}/${kbs.length} KBs updated for user=${userId}`);
  return updated;
}

// ============================================
// Helpers
// ============================================

async function lookupKbByName(
  name: string,
  userId: string
): Promise<{ id: string; name: string } | null> {
  const redis = getRedis();
  const userWsIds = await workspaceRepo.getUserWorkspaceIds(redis, userId);
  if (userWsIds.length === 0) return null;
  const needle = name.toLowerCase();
  const matches = (await kbRepo.getKbsByWorkspaces(redis, userWsIds))
    .filter((kb) => kb.name.toLowerCase() === needle)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  return matches[0] ? { id: matches[0].id, name: matches[0].name } : null;
}

async function getMostRecentKb(
  userId: string
): Promise<{ id: string; name: string } | null> {
  const redis = getRedis();
  const session = await sessionRepo.getLatestSession(redis, userId);
  if (session?.knowledge_bases_used?.[0]) {
    const kb = await kbRepo.getKb(redis, session.knowledge_bases_used[0]);
    if (kb) return { id: kb.id, name: kb.name };
  }

  // Fallback: most recently updated non-empty KB
  const userWsIds = await workspaceRepo.getUserWorkspaceIds(redis, userId);
  if (userWsIds.length === 0) return null;
  const kb = (await kbRepo.getKbsByWorkspaces(redis, userWsIds))
    .filter((k2) => k2.chunk_count > 0)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];
  return kb ? { id: kb.id, name: kb.name } : null;
}

async function getUserKbs(userId: string): Promise<KbCandidate[]> {
  const redis = getRedis();
  const userWsIds = await workspaceRepo.getUserWorkspaceIds(redis, userId);
  if (userWsIds.length === 0) return [];
  return (await kbRepo.getKbsByWorkspaces(redis, userWsIds))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .map((kb) => ({ id: kb.id, name: kb.name, description: kb.description }));
}

async function getRecentlyUpdatedKbs(
  userId: string,
  limit: number
): Promise<Array<{ id: string }>> {
  const redis = getRedis();
  const userWsIds = await workspaceRepo.getUserWorkspaceIds(redis, userId);
  if (userWsIds.length === 0) return [];
  return (await kbRepo.getKbsByWorkspaces(redis, userWsIds))
    .filter((kb) => kb.chunk_count > 0)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, limit)
    .map((kb) => ({ id: kb.id }));
}

/**
 * Anti-sprawl: check if a proposed KB name is semantically similar to any
 * existing KB. Uses simple word-overlap Jaccard similarity first (fast),
 * then falls back to embedding similarity for close calls.
 */
async function checkNameSimilarity(
  proposedName: string,
  existingKbs: KbCandidate[]
): Promise<{ id: string; name: string } | null> {
  const proposedWords = new Set(proposedName.toLowerCase().split(/\s+/));

  // Fast path: word-overlap Jaccard
  for (const kb of existingKbs) {
    const kbWords = new Set(kb.name.toLowerCase().split(/\s+/));
    const intersection = [...proposedWords].filter((w) => kbWords.has(w)).length;
    const union = new Set([...proposedWords, ...kbWords]).size;
    const jaccard = union > 0 ? intersection / union : 0;
    if (jaccard > 0.5) {
      return { id: kb.id, name: kb.name };
    }
  }

  // Slow path: embedding similarity (only check top 20)
  if (existingKbs.length > 0) {
    const proposedEmbedding = await generateEmbedding(proposedName);
    for (const kb of existingKbs.slice(0, 20)) {
      const nameEmbedding = await generateEmbedding(kb.name);
      const similarity = cosineSim(proposedEmbedding, nameEmbedding);
      if (similarity > 0.85) {
        return { id: kb.id, name: kb.name };
      }
    }
  }

  return null;
}

async function createKb(
  name: string,
  sessionSummary: string,
  summaryEmbedding: number[],
  userId: string
): Promise<{ id: string; name: string }> {
  const redis = getRedis();
  const defaultWs = await workspaceRepo.getDefaultWorkspace(redis, userId);
  if (!defaultWs) {
    throw new Error("No default workspace found for user — cannot auto-create KB");
  }

  const sentences = sessionSummary.match(/[^.!?]+[.!?]+/g) ?? [];
  const description = sentences.slice(0, 2).join(" ").trim() || sessionSummary.slice(0, 200);

  const createdKb = await kbRepo.createKb(redis, {
    workspace_id: defaultWs.id,
    name,
    description,
    kb_type: "general",
  });
  await kbRepo.updateKb(redis, createdKb.id, { auto_description: description });
  await kbRepo.setDescriptionEmbedding(redis, createdKb.id, summaryEmbedding);

  console.log(`[routing] auto-created KB "${createdKb.name}" (id=${createdKb.id})`);
  return { id: createdKb.id, name: createdKb.name };
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    nA += a[i] * a[i];
    nB += b[i] * b[i];
  }
  return dot / (Math.sqrt(nA) * Math.sqrt(nB));
}
