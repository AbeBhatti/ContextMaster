import type { CommitChunkInput } from "../lib/types.js";
import { generateEmbeddings } from "./embeddingService.js";
import { getRedis } from "../lib/redis.js";
import * as chunkRepo from "../lib/chunkRepo.js";
import * as kbRepo from "../lib/kbRepo.js";
import type { ChunkRow } from "../lib/chunkRepo.js";

// Dedup thresholds split by session to prevent cross-session false positives.
// Within a session, similar template text is expected; between sessions, two
// chunks must be near-identical (0.97+) before we treat the new one as
// superseding the old one. (Reference migration 008_session_aware_dedup.sql.)
const WITHIN_SESSION_THRESHOLD = 0.95;
const CROSS_SESSION_THRESHOLD = 0.97;
// Lower of the two — used as the search threshold so we get back any
// potentially relevant match and apply the session-aware threshold in code.
const DEDUP_RPC_THRESHOLD = WITHIN_SESSION_THRESHOLD;

// In-batch dedup threshold — if two chunks in the SAME commit are >= 0.95
// cosine similar AND share a chunk_type, we keep only the longer one.
const IN_BATCH_DEDUP_THRESHOLD = 0.95;

// Cap concurrency on the per-chunk dedup decisions.
const DEDUP_CONCURRENCY = 10;

function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let nA = 0;
  let nB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    nA += a[i] * a[i];
    nB += b[i] * b[i];
  }
  return dot / (Math.sqrt(nA) * Math.sqrt(nB));
}

async function pMap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export interface StoredChunkMapEntry {
  index: number;
  id: string;
  action: "created" | "deduplicated" | "superseded";
}

interface ChunkDecision {
  action: "create" | "skip" | "supersede";
  row?: ChunkRow;
  embedding?: number[];
  supersedeIds?: string[];
  existingId?: string;
  originalChunk: CommitChunkInput;
  originalIndex: number;
}

function buildRow(
  knowledgeBaseId: string,
  chunk: CommitChunkInput,
  userId: string,
  sessionId: string,
  validFrom: string,
  supersedes?: string | null
): ChunkRow {
  return {
    knowledge_base_id: knowledgeBaseId,
    content: chunk.content,
    chunk_type: chunk.chunk_type,
    topic_tags: chunk.topic_tags ?? [],
    related_chunk_ids: chunk.related_to ?? [],
    source_type: "session",
    status: "active",
    created_by: userId,
    session_id: sessionId,
    topic_key: chunk.topic_key ?? null,
    valid_from: validFrom,
    supersedes: supersedes ?? null,
  };
}

export async function storeChunks(
  knowledgeBaseId: string,
  chunks: CommitChunkInput[],
  userId: string,
  sessionId: string,
  validFrom: string
): Promise<{
  stored: number;
  deduplicated: number;
  superseded: number;
  chunkMap: StoredChunkMapEntry[];
}> {
  if (chunks.length === 0) {
    return { stored: 0, deduplicated: 0, superseded: 0, chunkMap: [] };
  }

  const redis = getRedis();
  const embeddings = await generateEmbeddings(chunks.map((c) => c.content));

  // ---- In-batch dedup guard (same-commit near-duplicates collapse) ----
  const dropped = new Set<number>();
  const droppedToSurvivor = new Map<number, number>();
  for (let i = 0; i < chunks.length; i++) {
    if (dropped.has(i)) continue;
    for (let j = i + 1; j < chunks.length; j++) {
      if (dropped.has(j)) continue;
      if (chunks[i].chunk_type !== chunks[j].chunk_type) continue;
      if (cosineSim(embeddings[i], embeddings[j]) < IN_BATCH_DEDUP_THRESHOLD) continue;
      if (chunks[i].content.length >= chunks[j].content.length) {
        dropped.add(j);
        droppedToSurvivor.set(j, i);
      } else {
        dropped.add(i);
        droppedToSurvivor.set(i, j);
        break;
      }
    }
  }
  function resolveSurvivor(idx: number): number {
    let s = idx;
    let guard = 0;
    while (dropped.has(s) && droppedToSurvivor.has(s) && guard++ < chunks.length) {
      const nx = droppedToSurvivor.get(s)!;
      if (nx === s) break;
      s = nx;
    }
    return s;
  }

  const batchDeduped: Array<{ chunk: CommitChunkInput; embedding: number[]; originalIndex: number }> = [];
  for (let i = 0; i < chunks.length; i++) {
    if (!dropped.has(i)) batchDeduped.push({ chunk: chunks[i], embedding: embeddings[i], originalIndex: i });
  }

  // ---- Decide actions concurrently (no writes yet) ----
  const decisions = await pMap(
    batchDeduped,
    (item) => decideChunk(knowledgeBaseId, item.chunk, item.embedding, userId, sessionId, validFrom, item.originalIndex),
    DEDUP_CONCURRENCY
  );

  const creates = decisions.filter((d) => d.action === "create");
  const supersedes = decisions.filter((d) => d.action === "supersede");
  const contentToId = new Map<string, string>();

  if (creates.length > 0) {
    const inserted = await chunkRepo.insertChunks(
      redis,
      creates.map((d) => ({ row: d.row!, embedding: d.embedding! }))
    );
    inserted.forEach((r) => contentToId.set(r.content, r.id));
  }

  if (supersedes.length > 0) {
    const inserted = await chunkRepo.insertChunks(
      redis,
      supersedes.map((d) => ({ row: d.row!, embedding: d.embedding! }))
    );
    inserted.forEach((r) => contentToId.set(r.content, r.id));

    const oldIds = supersedes.flatMap((d) => d.supersedeIds ?? []);
    if (oldIds.length > 0) {
      await chunkRepo.markSuperseded(redis, oldIds, validFrom);
    }

    for (const d of supersedes) {
      const newId = contentToId.get(d.row!.content);
      for (const oldId of d.supersedeIds ?? []) {
        console.log(
          JSON.stringify({
            event: "supersession",
            mechanism: d.originalChunk.topic_key ? "topic_key" : "similarity",
            old_chunk_id: oldId,
            new_chunk_id: newId,
            kb_id: knowledgeBaseId,
          })
        );
      }
    }
  }

  // ---- Build chunkMap (original index -> id + action) and counters ----
  const idByOriginalIndex = new Map<number, { id: string; action: "created" | "deduplicated" | "superseded" }>();
  for (const d of decisions) {
    if (d.action === "create") {
      const id = contentToId.get(d.row!.content);
      if (id) idByOriginalIndex.set(d.originalIndex, { id, action: "created" });
    } else if (d.action === "supersede") {
      const id = contentToId.get(d.row!.content);
      if (id) idByOriginalIndex.set(d.originalIndex, { id, action: "superseded" });
    } else {
      idByOriginalIndex.set(d.originalIndex, { id: d.existingId!, action: "deduplicated" });
    }
  }
  for (const drop of droppedToSurvivor.keys()) {
    const survivor = idByOriginalIndex.get(resolveSurvivor(drop));
    if (survivor) idByOriginalIndex.set(drop, { id: survivor.id, action: "deduplicated" });
  }

  let stored = 0;
  let deduplicated = 0;
  let superseded = 0;
  const chunkMap: StoredChunkMapEntry[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const entry = idByOriginalIndex.get(i);
    if (!entry) continue;
    chunkMap.push({ index: i, id: entry.id, action: entry.action });
    switch (entry.action) {
      case "created":
        stored++;
        break;
      case "deduplicated":
        deduplicated++;
        break;
      case "superseded":
        superseded++;
        stored++;
        break;
    }
  }

  const count = await chunkRepo.countActive(redis, [knowledgeBaseId]);
  await kbRepo.setChunkCount(redis, knowledgeBaseId, count);

  return { stored, deduplicated, superseded, chunkMap };
}

export interface StoreChunksRawInput {
  content: string;
  chunk_type: string;
  topic_tags?: string[];
  source_type?: string;
  topic_key?: string | null;
}

// Insert chunks without similarity-based dedup (Stage 1 coverage-gap chunks).
export async function storeChunksRaw(
  knowledgeBaseId: string,
  chunks: StoreChunksRawInput[],
  userId: string,
  sessionId: string,
  validFrom: string
): Promise<{ stored: number; ids: string[] }> {
  if (chunks.length === 0) return { stored: 0, ids: [] };

  const redis = getRedis();
  const embeddings = await generateEmbeddings(chunks.map((c) => c.content));

  const items = chunks.map((chunk, i) => ({
    row: {
      knowledge_base_id: knowledgeBaseId,
      content: chunk.content,
      chunk_type: chunk.chunk_type,
      topic_tags: chunk.topic_tags ?? [],
      related_chunk_ids: [],
      source_type: chunk.source_type ?? "session",
      status: "active",
      created_by: userId,
      session_id: sessionId,
      topic_key: chunk.topic_key ?? null,
      valid_from: validFrom,
    } as ChunkRow,
    embedding: embeddings[i],
  }));

  const inserted = await chunkRepo.insertChunks(redis, items);
  const ids = inserted.map((r) => r.id);

  const count = await chunkRepo.countActive(redis, [knowledgeBaseId]);
  await kbRepo.setChunkCount(redis, knowledgeBaseId, count);

  return { stored: ids.length, ids };
}

export async function deleteKnowledgeBase(knowledgeBaseId: string, workspaceId?: string): Promise<void> {
  const redis = getRedis();
  await chunkRepo.deleteChunksByKb(redis, knowledgeBaseId);
  await kbRepo.deleteKb(redis, knowledgeBaseId, workspaceId);
}

// ---- per-chunk decision (create / skip / supersede) ----

async function decideChunk(
  knowledgeBaseId: string,
  chunk: CommitChunkInput,
  embedding: number[],
  userId: string,
  sessionId: string,
  validFrom: string,
  originalIndex: number
): Promise<ChunkDecision> {
  if (chunk.topic_key && (chunk.chunk_type === "state" || chunk.chunk_type === "decision")) {
    return decideChunkByTopicKey(knowledgeBaseId, chunk, embedding, userId, sessionId, validFrom, originalIndex);
  }

  const redis = getRedis();
  const matches = await chunkRepo.findSimilarChunks(redis, knowledgeBaseId, embedding, DEDUP_RPC_THRESHOLD);

  if (matches.length > 0) {
    const topMatch = matches[0];
    const sameSession = topMatch.session_id === sessionId;
    const supersedeThreshold = sameSession ? WITHIN_SESSION_THRESHOLD : CROSS_SESSION_THRESHOLD;

    // Very high similarity + same type => duplicate, skip.
    if (topMatch.similarity > 0.97 && topMatch.chunk_type === chunk.chunk_type) {
      return { action: "skip", existingId: topMatch.id, originalChunk: chunk, originalIndex };
    }

    // High similarity, content differs => supersede.
    if (topMatch.similarity > supersedeThreshold) {
      return {
        action: "supersede",
        supersedeIds: [topMatch.id],
        row: buildRow(knowledgeBaseId, chunk, userId, sessionId, validFrom, topMatch.id),
        embedding,
        originalChunk: chunk,
        originalIndex,
      };
    }
  }

  return {
    action: "create",
    row: buildRow(knowledgeBaseId, chunk, userId, sessionId, validFrom),
    embedding,
    originalChunk: chunk,
    originalIndex,
  };
}

// Stage 4: deterministic supersession via topic_key.
async function decideChunkByTopicKey(
  knowledgeBaseId: string,
  chunk: CommitChunkInput,
  embedding: number[],
  userId: string,
  sessionId: string,
  validFrom: string,
  originalIndex: number
): Promise<ChunkDecision> {
  const redis = getRedis();
  const topicKey = chunk.topic_key!;
  const oldIds = await chunkRepo.findActiveByTopicKey(redis, knowledgeBaseId, topicKey);

  if (oldIds.length === 0) {
    return {
      action: "create",
      row: buildRow(knowledgeBaseId, chunk, userId, sessionId, validFrom),
      embedding,
      originalChunk: chunk,
      originalIndex,
    };
  }

  return {
    action: "supersede",
    supersedeIds: oldIds,
    row: buildRow(knowledgeBaseId, chunk, userId, sessionId, validFrom),
    embedding,
    originalChunk: chunk,
    originalIndex,
  };
}
