import { getRedis } from "../lib/redis.js";
import { generateEmbedding } from "./embeddingService.js";
import * as chunkRepo from "../lib/chunkRepo.js";
import * as kbRepo from "../lib/kbRepo.js";
import { k } from "../lib/keys.js";

const DEFAULT_MAX_RESULTS = 16;
const BROAD_QUERY_MIN_RESULTS = 20;
const AUTO_FILTER_DOMINANCE_THRESHOLD = 0.6;

// Temporal reranking — fuses normalized RRF score with exponential recency
// decay on valid_from. Per-type decay rates: volatile facts (state/decision)
// decay fast, stable facts (reference/convention/session_summary) decay slow.
const CHUNK_TYPE_DECAY: Record<string, number> = {
  state: 0.995,
  decision: 0.995,
  context: 0.998,
  finding: 0.998,
  convention: 0.9995,
  reference: 0.9995,
  question: 0.998,
  session_summary: 0.9995,
};
const DEFAULT_DECAY = 0.998;
// 70% relevance / 30% recency.
const TEMPORAL_WEIGHT = 0.3;
const SESSION_SUMMARY_INCLUDE_COUNT = 3;

const TYPE_INTENT_MAP: Record<string, string> = {
  decision: "decision",
  decisions: "decision",
  finding: "finding",
  findings: "finding",
  convention: "convention",
  conventions: "convention",
  state: "state",
  states: "state",
  status: "state",
  question: "question",
  questions: "question",
  reference: "reference",
  references: "reference",
};

function detectChunkTypeIntent(query: string): string | null {
  const q = query.toLowerCase();
  const words = q.split(/\W+/).filter(Boolean);
  const looksMetaShape = /^(what|list|show|give\s+me|tell\s+me)\b/.test(q) && words.length <= 8;
  if (!looksMetaShape) return null;
  for (const w of words) {
    if (TYPE_INTENT_MAP[w]) return TYPE_INTENT_MAP[w];
  }
  return null;
}

function applyTemporalScoring(chunks: RecallResponse["chunks"]): RecallResponse["chunks"] {
  if (chunks.length === 0) return chunks;

  const now = Date.now();
  const scores = chunks.map((c) => c.rrf_score ?? 0);
  const maxRRF = Math.max(...scores);
  const minRRF = Math.min(...scores);
  const rrfRange = maxRRF - minRRF || 1;

  const scored = chunks.map((chunk) => {
    const relevanceScore = ((chunk.rrf_score ?? 0) - minRRF) / rrfRange;

    const timestamp = chunk.valid_from ?? chunk.created_at ?? null;
    let recencyScore = 0.5;
    if (timestamp) {
      const ageHours = Math.max(0, (now - new Date(timestamp).getTime()) / 3_600_000);
      const decayRate = CHUNK_TYPE_DECAY[chunk.chunk_type] ?? DEFAULT_DECAY;
      recencyScore = Math.pow(decayRate, ageHours);
    }

    const temporal_score = (1 - TEMPORAL_WEIGHT) * relevanceScore + TEMPORAL_WEIGHT * recencyScore;
    return { chunk, temporal_score };
  });

  scored.sort((a, b) => b.temporal_score - a.temporal_score);
  return scored.map((s) => s.chunk);
}

export interface RecallOptions {
  query: string;
  knowledgeBaseIds?: string[];
  maxResults?: number;
  chunkTypes?: string[];
  userId?: string;
  /** When true, also return the two pre-fusion retrieval arms (additive). */
  explain?: boolean;
}

// One candidate from a single retrieval arm, before fusion.
export interface RecallExplainArm {
  id: string;
  knowledge_base_id: string;
  knowledge_base_name: string;
  content: string;
  chunk_type: string;
  score: number; // cosine similarity (vector arm) or BM25 score (bm25 arm)
  rank: number; // 1-based position within this arm
}

// One row of the fused result, with the fusion + temporal signals exposed.
export interface RecallExplainCombined {
  id: string;
  knowledge_base_id: string;
  knowledge_base_name: string;
  content: string;
  chunk_type: string;
  rrf_score: number;
  temporal_weight: number; // per-chunk recency weight (decay^ageHours), 0..1
  vec_rank: number | null;
  fts_rank: number | null;
  valid_from: string | null;
  created_at: string;
}

export interface RecallExplain {
  vector: RecallExplainArm[]; // sorted by cosine desc
  bm25: RecallExplainArm[]; // sorted by BM25 desc
  combined: RecallExplainCombined[]; // sorted by RRF desc (rank 1 = highest)
}

// Per-chunk recency weight used by the temporal reranker: exponential decay on
// the chunk's age, with a per-type decay rate. Exposed so the viz can show the
// real "temporal weight" the engine applies (not a hardcoded number).
function recencyWeightFor(chunkType: string, timestamp: string | null): number {
  if (!timestamp) return 0.5;
  const ageHours = Math.max(0, (Date.now() - new Date(timestamp).getTime()) / 3_600_000);
  const decayRate = CHUNK_TYPE_DECAY[chunkType] ?? DEFAULT_DECAY;
  return Math.pow(decayRate, ageHours);
}

export interface LinkedChunk {
  id: string;
  knowledge_base_id: string;
  content: string;
  chunk_type: string;
  topic_tags: string[];
  source_type: string;
  created_at: string;
}

export interface RecallResponse {
  chunks: Array<{
    id: string;
    knowledge_base_id: string;
    knowledge_base_name: string;
    content: string;
    chunk_type: string;
    topic_tags: string[];
    source_type: string;
    similarity: number;
    rrf_score: number;
    created_at: string;
    valid_from: string | null;
    valid_to: string | null;
    linked_chunks: LinkedChunk[];
  }>;
  applied_chunk_type_filter?: string;
  explain?: RecallExplain;
}

// Default search scope: all KBs in the user's open-scope workspaces. Populated
// once workspaces exist (phase 6); until then callers pass explicit kb ids.
async function getAllOpenKbIds(userId: string): Promise<string[]> {
  const redis = getRedis();
  const wsIds = await redis.sMembers(k.userWorkspaces(userId));
  if (wsIds.length === 0) return [];

  const openWsIds: string[] = [];
  await Promise.all(
    wsIds.map(async (wsId) => {
      const scope = (await redis.hGet(k.workspace(wsId), "retrieval_scope")) ?? "open";
      if (scope === "open") openWsIds.push(wsId);
    })
  );
  if (openWsIds.length === 0) return [];

  const kbIdLists = await Promise.all(openWsIds.map((wsId) => redis.sMembers(k.workspaceKbs(wsId))));
  return [...new Set(kbIdLists.flat())];
}

export async function recall(options: RecallOptions): Promise<RecallResponse> {
  const redis = getRedis();
  const { query, chunkTypes, userId } = options;

  let knowledgeBaseIds = options.knowledgeBaseIds;
  if (!knowledgeBaseIds || knowledgeBaseIds.length === 0) {
    if (!userId) return { chunks: [] };
    knowledgeBaseIds = await getAllOpenKbIds(userId);
  }
  if (knowledgeBaseIds.length === 0) return { chunks: [] };

  // Auto-filter type-structural meta-queries when the caller didn't filter.
  let effectiveTypes = chunkTypes;
  let appliedIntent: string | undefined;
  if (!chunkTypes || chunkTypes.length === 0) {
    const intent = detectChunkTypeIntent(query);
    if (intent) {
      effectiveTypes = [intent];
      appliedIntent = intent;
    }
  }

  // Safety valve: if the auto-detected type covers < 60% of the KB, the KB is
  // mixed and filtering would starve minority types — search all types.
  let safetyValveTripped = false;
  if (appliedIntent) {
    const [total, filtered] = await Promise.all([
      chunkRepo.countActive(redis, knowledgeBaseIds),
      chunkRepo.countActive(redis, knowledgeBaseIds, appliedIntent),
    ]);
    if (total > 0 && filtered / total < AUTO_FILTER_DOMINANCE_THRESHOLD) {
      effectiveTypes = undefined;
      appliedIntent = undefined;
      safetyValveTripped = true;
    }
  }

  const filterIsApplied = !!effectiveTypes && effectiveTypes.length > 0;
  const baseMaxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const matchCount = filterIsApplied ? baseMaxResults : Math.max(baseMaxResults, BROAD_QUERY_MIN_RESULTS);

  const queryEmbedding = await generateEmbedding(query);

  // Disable the 0.20 floor when the safety valve fired (the auto-filter was
  // meant to surface type-level matches that may sit below the floor).
  const minVectorSimilarity = safetyValveTripped ? 0 : 0.2;

  const hybridParams = {
    kbIds: knowledgeBaseIds,
    queryText: query,
    queryEmbedding,
    chunkTypes: effectiveTypes && effectiveTypes.length > 0 ? effectiveTypes : null,
    matchCount,
    minVectorSimilarity,
  };

  // In explain mode, run the explain variant once and reuse its fused output as
  // `rows` (it is byte-for-byte identical to hybridRecall) so we don't query
  // twice. The raw arms are kept aside to build the response.explain block.
  let explainBundle: Awaited<ReturnType<typeof chunkRepo.hybridRecallExplain>> | null = null;
  let rows;
  if (options.explain) {
    explainBundle = await chunkRepo.hybridRecallExplain(redis, hybridParams);
    rows = explainBundle.fused;
  } else {
    rows = await chunkRepo.hybridRecall(redis, hybridParams);
  }

  const kbIds = [...new Set(rows.map((r) => r.knowledge_base_id))];
  const kbNameMap = await kbRepo.getKbNames(redis, kbIds);

  // ---- Linked chunk expansion ----
  const linkedByParent = new Map<string, LinkedChunk[]>();
  if (rows.length > 0) {
    const resultIds = rows.map((r) => r.id);
    const seenLinkedIds = new Set<string>(resultIds);

    // (a) chunks that link TO any result
    const incoming = await chunkRepo.getIncomingLinks(redis, resultIds);
    for (const linked of incoming) {
      if (seenLinkedIds.has(linked.id)) continue;
      seenLinkedIds.add(linked.id);
      for (const parentId of linked.related_chunk_ids) {
        if (!resultIds.includes(parentId)) continue;
        const list = linkedByParent.get(parentId) ?? [];
        list.push({
          id: linked.id,
          knowledge_base_id: linked.knowledge_base_id,
          content: linked.content,
          chunk_type: linked.chunk_type,
          topic_tags: linked.topic_tags,
          source_type: linked.source_type,
          created_at: linked.created_at,
        });
        linkedByParent.set(parentId, list);
      }
    }

    // (b) chunks that results link TO
    const outgoingIds = new Set<string>();
    for (const r of rows) {
      for (const id of r.related_chunk_ids) {
        if (!seenLinkedIds.has(id)) outgoingIds.add(id);
      }
    }
    if (outgoingIds.size > 0) {
      const outgoing = await chunkRepo.getActiveChunksByIds(redis, [...outgoingIds]);
      const outgoingById = new Map<string, LinkedChunk>();
      for (const linked of outgoing) {
        seenLinkedIds.add(linked.id);
        outgoingById.set(linked.id, {
          id: linked.id,
          knowledge_base_id: linked.knowledge_base_id,
          content: linked.content,
          chunk_type: linked.chunk_type,
          topic_tags: linked.topic_tags,
          source_type: linked.source_type,
          created_at: linked.created_at,
        });
      }
      for (const r of rows) {
        const list = linkedByParent.get(r.id) ?? [];
        for (const id of r.related_chunk_ids) {
          const linked = outgoingById.get(id);
          if (linked) list.push(linked);
        }
        if (list.length > 0) linkedByParent.set(r.id, list);
      }
    }
  }

  const mappedResults: RecallResponse["chunks"] = rows.map((r) => ({
    id: r.id,
    knowledge_base_id: r.knowledge_base_id,
    knowledge_base_name: kbNameMap.get(r.knowledge_base_id) ?? "Unknown",
    content: r.content,
    chunk_type: r.chunk_type,
    topic_tags: r.topic_tags,
    source_type: r.source_type,
    similarity: r.vector_similarity ?? 0,
    rrf_score: r.rrf_score,
    created_at: r.created_at,
    valid_from: r.valid_from,
    valid_to: r.valid_to,
    linked_chunks: linkedByParent.get(r.id) ?? [],
  }));

  const deduped = deduplicateResults(mappedResults);
  const reranked = applyTemporalScoring(deduped);

  // Always include the most recent session summaries (unless the caller
  // explicitly filtered to types that exclude session_summary).
  const summariesAllowed =
    !effectiveTypes || effectiveTypes.length === 0 || effectiveTypes.includes("session_summary");

  let finalChunks: RecallResponse["chunks"] = reranked;
  if (summariesAllowed) {
    const recentSummaries = await chunkRepo.getRecentSummaries(
      redis,
      knowledgeBaseIds,
      SESSION_SUMMARY_INCLUDE_COUNT
    );
    if (recentSummaries.length > 0) {
      const existingIds = new Set(reranked.map((c) => c.id));
      const missingKbIds = recentSummaries
        .map((s) => s.knowledge_base_id)
        .filter((id) => !kbNameMap.has(id));
      if (missingKbIds.length > 0) {
        const extra = await kbRepo.getKbNames(redis, [...new Set(missingKbIds)]);
        for (const [id, name] of extra) kbNameMap.set(id, name);
      }
      const newSummaries: RecallResponse["chunks"] = recentSummaries
        .filter((s) => !existingIds.has(s.id))
        .map((s) => ({
          id: s.id,
          knowledge_base_id: s.knowledge_base_id,
          knowledge_base_name: kbNameMap.get(s.knowledge_base_id) ?? "Unknown",
          content: s.content,
          chunk_type: s.chunk_type,
          topic_tags: s.topic_tags,
          source_type: s.source_type,
          similarity: 0,
          rrf_score: 0,
          created_at: s.created_at,
          valid_from: s.valid_from,
          valid_to: s.valid_to,
          linked_chunks: [],
        }));
      finalChunks = [...newSummaries, ...reranked];
    }
  }

  let explain: RecallExplain | undefined;
  if (explainBundle) {
    // Resolve KB names for any arm/combined chunks not already mapped.
    const explainKbIds = new Set<string>();
    for (const a of explainBundle.vectorArm) explainKbIds.add(a.knowledge_base_id);
    for (const a of explainBundle.bm25Arm) explainKbIds.add(a.knowledge_base_id);
    for (const f of explainBundle.fused) explainKbIds.add(f.knowledge_base_id);
    const missing = [...explainKbIds].filter((id) => id && !kbNameMap.has(id));
    if (missing.length > 0) {
      const extra = await kbRepo.getKbNames(redis, missing);
      for (const [id, name] of extra) kbNameMap.set(id, name);
    }
    const nameOf = (id: string) => kbNameMap.get(id) ?? "Unknown";

    // Rank lookups so the combined rows can show each chunk's source ranks.
    const vecRankById = new Map(explainBundle.vectorArm.map((a) => [a.id, a.rank]));
    const ftsRankById = new Map(explainBundle.bm25Arm.map((a) => [a.id, a.rank]));

    const vector = [...explainBundle.vectorArm]
      .sort((a, b) => b.score - a.score)
      .map((a) => ({
        id: a.id,
        knowledge_base_id: a.knowledge_base_id,
        knowledge_base_name: nameOf(a.knowledge_base_id),
        content: a.content,
        chunk_type: a.chunk_type,
        score: a.score,
        rank: a.rank,
      }));

    const bm25 = [...explainBundle.bm25Arm]
      .sort((a, b) => b.score - a.score)
      .map((a) => ({
        id: a.id,
        knowledge_base_id: a.knowledge_base_id,
        knowledge_base_name: nameOf(a.knowledge_base_id),
        content: a.content,
        chunk_type: a.chunk_type,
        score: a.score,
        rank: a.rank,
      }));

    // Combined column: the genuine RRF fusion output, sorted by RRF desc so
    // rank 1 = highest RRF and scores decrease monotonically down the list.
    const combined = [...explainBundle.fused]
      .sort((a, b) => b.rrf_score - a.rrf_score)
      .map((f) => ({
        id: f.id,
        knowledge_base_id: f.knowledge_base_id,
        knowledge_base_name: nameOf(f.knowledge_base_id),
        content: f.content,
        chunk_type: f.chunk_type,
        rrf_score: f.rrf_score,
        temporal_weight: recencyWeightFor(f.chunk_type, f.valid_from ?? f.created_at ?? null),
        vec_rank: vecRankById.get(f.id) ?? null,
        fts_rank: ftsRankById.get(f.id) ?? null,
        valid_from: f.valid_from,
        created_at: f.created_at,
      }));

    explain = { vector, bm25, combined };
  }

  return { chunks: finalChunks, applied_chunk_type_filter: appliedIntent, explain };
}

// Cross-KB dedup of PRIMARY results (linked_chunks left untouched).
function deduplicateResults(chunks: RecallResponse["chunks"]): RecallResponse["chunks"] {
  const seen = new Map<string, number>();
  const deduped: RecallResponse["chunks"] = [];

  for (const chunk of chunks) {
    const rawContent = chunk.content.replace(/^\[from knowledge base: [^\]]+\]\s*/, "");
    const key = rawContent.substring(0, 200).toLowerCase().trim();

    const existingIndex = seen.get(key);
    if (existingIndex !== undefined) {
      const existing = deduped[existingIndex];
      const existingScore = existing.rrf_score || existing.similarity || 0;
      const newScore = chunk.rrf_score || chunk.similarity || 0;
      if (newScore > existingScore) deduped[existingIndex] = chunk;
    } else {
      seen.set(key, deduped.length);
      deduped.push(chunk);
    }
  }

  return deduped;
}
