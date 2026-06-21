import { randomUUID } from "node:crypto";
import type { RedisClient } from "./redis.js";
import { idx, chunkPrefix, k } from "./keys.js";
import { escapeTag, tagIn, floatBuf } from "./search.js";

// ============================================================
// Redis data layer for knowledge_chunks. This is the seam that replaces
// Postgres: the same logical operations the reference ran as SQL/RPCs are
// reimplemented here as RediSearch queries + hash writes. The services on top
// (chunkService, recallService) keep the reference's algorithms unchanged.
// ============================================================

// Reciprocal Rank Fusion constant — must match the reference's rrf_k = 60.
export const RRF_K = 60;

export interface ChunkRow {
  knowledge_base_id: string;
  content: string;
  chunk_type: string;
  topic_tags: string[];
  related_chunk_ids: string[];
  source_type: string;
  status: string;
  created_by: string | null;
  session_id: string | null;
  topic_key: string | null;
  valid_from: string; // ISO or epoch-ms string
  supersedes?: string | null;
  source_document_id?: string | null;
}

export interface SimilarChunkResult {
  id: string;
  content: string;
  chunk_type: string;
  session_id: string | null;
  similarity: number;
}

export interface HybridRow {
  id: string;
  knowledge_base_id: string;
  content: string;
  chunk_type: string;
  topic_tags: string[];
  related_chunk_ids: string[];
  source_type: string;
  status: string;
  vector_similarity: number;
  fts_rank: number;
  rrf_score: number;
  created_at: string;
  valid_from: string | null;
  valid_to: string | null;
}

export interface LinkedRow {
  id: string;
  knowledge_base_id: string;
  content: string;
  chunk_type: string;
  topic_tags: string[];
  source_type: string;
  created_at: string;
  related_chunk_ids: string[];
}

export interface SummaryRow extends LinkedRow {
  valid_from: string | null;
  valid_to: string | null;
}

// ---- small helpers -------------------------------------------------

function bufToStr(x: unknown): string {
  return Buffer.isBuffer(x) ? x.toString("utf8") : String(x ?? "");
}

function epochOf(v: string | number): number {
  if (typeof v === "number") return v;
  const s = v.trim();
  if (/^\d+$/.test(s)) return Number(s);
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? Date.now() : t;
}

function msToIso(ms: string | number | null | undefined): string | null {
  if (ms == null || ms === "") return null;
  const n = Number(ms);
  if (Number.isNaN(n)) return null;
  return new Date(n).toISOString();
}

function splitTags(v: string | undefined): string[] {
  if (!v) return [];
  return v.split("|").filter(Boolean);
}

// FT.SEARCH reply with RETURN (no scores): [count, key, [f,v,...], key, [...], ...]
function parseSearch(reply: unknown): Array<{ id: string; fields: Record<string, string> }> {
  const arr = reply as unknown[];
  if (!Array.isArray(arr)) return [];
  const out: Array<{ id: string; fields: Record<string, string> }> = [];
  for (let i = 1; i < arr.length; i += 2) {
    const key = bufToStr(arr[i]);
    const rawFields = arr[i + 1];
    const fields: Record<string, string> = {};
    if (Array.isArray(rawFields)) {
      for (let j = 0; j < rawFields.length; j += 2) {
        fields[bufToStr(rawFields[j])] = bufToStr(rawFields[j + 1]);
      }
    }
    out.push({ id: key.startsWith(chunkPrefix) ? key.slice(chunkPrefix.length) : key, fields });
  }
  return out;
}

// FT.SEARCH reply with NOCONTENT: [count, key, key, ...]
function parseSearchKeys(reply: unknown): string[] {
  const arr = reply as unknown[];
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (let i = 1; i < arr.length; i++) {
    const key = bufToStr(arr[i]);
    out.push(key.startsWith(chunkPrefix) ? key.slice(chunkPrefix.length) : key);
  }
  return out;
}

function searchCount(reply: unknown): number {
  const arr = reply as unknown[];
  return Array.isArray(arr) && typeof arr[0] === "number" ? (arr[0] as number) : 0;
}

const READ_FIELDS = [
  "content",
  "chunk_type",
  "topic_tags",
  "related_chunk_ids",
  "source_type",
  "knowledge_base_id",
  "created_at",
  "valid_from",
  "valid_to",
  "status",
];

// ---- writes --------------------------------------------------------

// Bulk insert. Returns {id, content} for each inserted chunk so the caller can
// map results back by content (matching the reference's bulk-insert pattern).
export async function insertChunks(
  redis: RedisClient,
  items: Array<{ row: ChunkRow; embedding: number[] }>
): Promise<Array<{ id: string; content: string }>> {
  const now = Date.now();
  const writes: Promise<unknown>[] = [];
  const out: Array<{ id: string; content: string }> = [];

  for (const { row, embedding } of items) {
    const id = randomUUID();
    const key = k.chunk(id);
    const fields: string[] = [
      "knowledge_base_id", row.knowledge_base_id,
      "content", row.content,
      "chunk_type", row.chunk_type,
      "source_type", row.source_type,
      "status", row.status,
      "created_at", String(now),
      "updated_at", String(now),
      "valid_from", String(epochOf(row.valid_from)),
    ];
    if (row.topic_tags.length) fields.push("topic_tags", row.topic_tags.join("|"));
    if (row.related_chunk_ids.length) fields.push("related_chunk_ids", row.related_chunk_ids.join("|"));
    if (row.created_by) fields.push("created_by", row.created_by);
    if (row.session_id) fields.push("session_id", row.session_id);
    if (row.topic_key) fields.push("topic_key", row.topic_key);
    if (row.supersedes) fields.push("supersedes", row.supersedes);
    if (row.source_document_id) fields.push("source_document_id", row.source_document_id);

    writes.push(redis.sendCommand(["HSET", key, ...fields, "embedding", floatBuf(embedding)]));
    writes.push(redis.sAdd(k.kbChunks(row.knowledge_base_id), id));
    out.push({ id, content: row.content });
  }

  await Promise.all(writes);
  return out;
}

// Supersede a single chunk only if it's currently active (idempotent guard for
// the super-commit LLM-conflict path; mirrors the reference's
// `.eq("status","active")` on the update). Returns true if it flipped a row.
export async function supersedeActiveChunk(
  redis: RedisClient,
  id: string,
  validToIso: string
): Promise<boolean> {
  const status = (await redis.hGet(k.chunk(id), "status")) as string | null;
  if (status !== "active") return false;
  await redis.sendCommand([
    "HSET", k.chunk(id), "status", "superseded", "valid_to", String(epochOf(validToIso)), "updated_at", String(Date.now()),
  ]);
  return true;
}

// Mark chunks superseded: status='superseded', valid_to=<superseding validFrom>.
export async function markSuperseded(
  redis: RedisClient,
  ids: string[],
  validToIso: string
): Promise<void> {
  if (ids.length === 0) return;
  const validTo = String(epochOf(validToIso));
  const now = String(Date.now());
  await Promise.all(
    ids.map((id) =>
      redis.sendCommand(["HSET", k.chunk(id), "status", "superseded", "valid_to", validTo, "updated_at", now])
    )
  );
}

// ---- dedup (replaces find_similar_chunks) --------------------------

export async function findSimilarChunks(
  redis: RedisClient,
  kbId: string,
  embedding: number[],
  threshold: number
): Promise<SimilarChunkResult[]> {
  const query = `(@knowledge_base_id:{${escapeTag(kbId)}} @status:{active})=>[KNN 5 @embedding $BLOB AS vec_score]`;
  const reply = await redis.sendCommand([
    "FT.SEARCH", idx.chunks, query,
    "PARAMS", "2", "BLOB", floatBuf(embedding),
    "SORTBY", "vec_score", "ASC",
    "LIMIT", "0", "5",
    "RETURN", "4", "content", "chunk_type", "session_id", "vec_score",
    "DIALECT", "2",
  ]);
  const rows = parseSearch(reply);
  return rows
    .map((r) => ({
      id: r.id,
      content: r.fields.content ?? "",
      chunk_type: r.fields.chunk_type ?? "",
      session_id: r.fields.session_id ?? null,
      // COSINE distance -> cosine similarity, exactly 1 - (a <=> b).
      similarity: 1 - Number(r.fields.vec_score ?? 1),
    }))
    .filter((m) => m.similarity > threshold);
}

// Stage 4: active chunks in a KB sharing a topic_key (deterministic supersession).
export async function findActiveByTopicKey(
  redis: RedisClient,
  kbId: string,
  topicKey: string
): Promise<string[]> {
  const query = `@knowledge_base_id:{${escapeTag(kbId)}} @status:{active} @topic_key:{${escapeTag(topicKey)}}`;
  const reply = await redis.sendCommand([
    "FT.SEARCH", idx.chunks, query, "NOCONTENT", "LIMIT", "0", "1000", "DIALECT", "2",
  ]);
  return parseSearchKeys(reply);
}

export async function countActive(
  redis: RedisClient,
  kbIds: string[],
  chunkType?: string
): Promise<number> {
  if (kbIds.length === 0) return 0;
  let query = `${tagIn("knowledge_base_id", kbIds)} @status:{active}`;
  if (chunkType) query += ` ${tagIn("chunk_type", [chunkType])}`;
  const reply = await redis.sendCommand(["FT.SEARCH", idx.chunks, query, "LIMIT", "0", "0", "DIALECT", "2"]);
  return searchCount(reply);
}

// Entity-overlap signal for KB routing (replaces the reference's
// .textSearch("content_tsv", terms, { type: "plain" }) count). Counts active
// chunks in a KB whose content matches the distinctive terms via BM25. Terms
// are sanitised to word tokens so URLs/version strings don't break the parser;
// returns 0 on any parse error, exactly like the reference's error fallback.
export async function countActiveByText(
  redis: RedisClient,
  kbId: string,
  terms: string[]
): Promise<number> {
  if (terms.length === 0) return 0;
  const tokens = terms
    .map((t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
    .filter(Boolean);
  if (tokens.length === 0) return 0;
  const phrase = tokens.join(" ");
  const query = `@knowledge_base_id:{${escapeTag(kbId)}} @status:{active} @content:(${phrase})`;
  try {
    const reply = await redis.sendCommand([
      "FT.SEARCH", idx.chunks, query, "LIMIT", "0", "0", "DIALECT", "2",
    ]);
    return searchCount(reply);
  } catch {
    return 0;
  }
}

// Recent content for KBs, by chunk_type, newest first (KB description
// regeneration). Returns just the content strings.
export async function getRecentContentsByType(
  redis: RedisClient,
  kbId: string,
  chunkType: string,
  limit: number
): Promise<string[]> {
  const query = `@knowledge_base_id:{${escapeTag(kbId)}} @status:{active} @chunk_type:{${escapeTag(
    chunkType
  )}}`;
  const reply = await redis.sendCommand([
    "FT.SEARCH", idx.chunks, query,
    "SORTBY", "created_at", "DESC",
    "LIMIT", "0", String(limit),
    "RETURN", "1", "content",
    "DIALECT", "2",
  ]);
  return parseSearch(reply).map((r) => r.fields.content ?? "").filter(Boolean);
}

// Recent content + type for a KB EXCLUDING one chunk_type, newest first.
export async function getRecentContentsExcludingType(
  redis: RedisClient,
  kbId: string,
  excludeType: string,
  limit: number
): Promise<Array<{ content: string; chunk_type: string }>> {
  const query = `@knowledge_base_id:{${escapeTag(kbId)}} @status:{active} -@chunk_type:{${escapeTag(
    excludeType
  )}}`;
  const reply = await redis.sendCommand([
    "FT.SEARCH", idx.chunks, query,
    "SORTBY", "created_at", "DESC",
    "LIMIT", "0", String(limit),
    "RETURN", "2", "content", "chunk_type",
    "DIALECT", "2",
  ]);
  return parseSearch(reply)
    .map((r) => ({ content: r.fields.content ?? "", chunk_type: r.fields.chunk_type ?? "" }))
    .filter((r) => r.content);
}

// ---- hybrid recall (replaces hybrid_recall_chunks RPC) -------------

// Distill a natural-language query into AND-ed content terms, mirroring
// websearch_to_tsquery/plainto_tsquery semantics. Returns null when there are
// no usable terms (then the BM25 arm is skipped and recall is vector-only).
function toTextQuery(query: string): string | null {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return null;
  return tokens.join(" ");
}

export interface HybridRecallParams {
  kbIds: string[];
  queryText: string;
  queryEmbedding: number[];
  chunkTypes?: string[] | null;
  matchCount: number;
  minVectorSimilarity: number;
}

export async function hybridRecall(redis: RedisClient, p: HybridRecallParams): Promise<HybridRow[]> {
  if (p.kbIds.length === 0) return [];

  const filterParts = [tagIn("knowledge_base_id", p.kbIds), "@status:{active}"];
  if (p.chunkTypes && p.chunkTypes.length > 0) filterParts.push(tagIn("chunk_type", p.chunkTypes));
  const filter = filterParts.join(" ");
  const typeFilterApplied = !!(p.chunkTypes && p.chunkTypes.length > 0);

  const ret = ["RETURN", String(READ_FIELDS.length + 1), ...READ_FIELDS, "vec_score"];

  // --- vector arm: KNN 60 ---
  const vecReply = await redis.sendCommand([
    "FT.SEARCH", idx.chunks,
    `(${filter})=>[KNN 60 @embedding $BLOB AS vec_score]`,
    "PARAMS", "2", "BLOB", floatBuf(p.queryEmbedding),
    "SORTBY", "vec_score", "ASC",
    "LIMIT", "0", "60",
    ...ret,
    "DIALECT", "2",
  ]);
  let vecRows = parseSearch(vecReply).map((r) => ({
    ...r,
    sim: 1 - Number(r.fields.vec_score ?? 1),
  }));
  // The 0.20 similarity floor only applies when no chunk_type filter is set —
  // when the caller narrowed by type, the type filter IS the quality signal.
  if (!typeFilterApplied) {
    vecRows = vecRows.filter((r) => r.sim > p.minVectorSimilarity);
  }

  // --- BM25 arm: top 60 by full-text relevance ---
  let ftsRows: Array<{ id: string; fields: Record<string, string> }> = [];
  const textQuery = toTextQuery(p.queryText);
  if (textQuery) {
    try {
      const ftsReply = await redis.sendCommand([
        "FT.SEARCH", idx.chunks,
        `${filter} @content:(${textQuery})`,
        "SCORER", "BM25",
        "LIMIT", "0", "60",
        ...ret,
        "DIALECT", "2",
      ]);
      ftsRows = parseSearch(ftsReply);
    } catch {
      // Pure-stopword / unparseable text query — fall back to vector-only.
      ftsRows = [];
    }
  }

  // --- RRF fusion: 1/(k+rank) from each arm ---
  interface Fused {
    fields: Record<string, string>;
    sim: number;
    vecRank?: number;
    ftsRank?: number;
  }
  const fused = new Map<string, Fused>();
  vecRows.forEach((r, i) => {
    fused.set(r.id, { fields: r.fields, sim: r.sim, vecRank: i + 1 });
  });
  ftsRows.forEach((r, i) => {
    const existing = fused.get(r.id);
    if (existing) existing.ftsRank = i + 1;
    else fused.set(r.id, { fields: r.fields, sim: 0, ftsRank: i + 1 });
  });

  const scored = [...fused.entries()].map(([id, f]) => {
    const score =
      (f.vecRank ? 1 / (RRF_K + f.vecRank) : 0) + (f.ftsRank ? 1 / (RRF_K + f.ftsRank) : 0);
    return { id, f, score };
  });
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, p.matchCount).map(({ id, f, score }) => ({
    id,
    knowledge_base_id: f.fields.knowledge_base_id ?? "",
    content: f.fields.content ?? "",
    chunk_type: f.fields.chunk_type ?? "",
    topic_tags: splitTags(f.fields.topic_tags),
    related_chunk_ids: splitTags(f.fields.related_chunk_ids),
    source_type: f.fields.source_type ?? "session",
    status: f.fields.status ?? "active",
    vector_similarity: f.sim,
    fts_rank: f.ftsRank ?? 0,
    rrf_score: score,
    created_at: msToIso(f.fields.created_at) ?? new Date().toISOString(),
    valid_from: msToIso(f.fields.valid_from),
    valid_to: msToIso(f.fields.valid_to),
  }));
}

// ---- linked-chunk expansion ----------------------------------------

function toLinkedRow(r: { id: string; fields: Record<string, string> }): LinkedRow {
  return {
    id: r.id,
    knowledge_base_id: r.fields.knowledge_base_id ?? "",
    content: r.fields.content ?? "",
    chunk_type: r.fields.chunk_type ?? "",
    topic_tags: splitTags(r.fields.topic_tags),
    source_type: r.fields.source_type ?? "session",
    created_at: msToIso(r.fields.created_at) ?? new Date().toISOString(),
    related_chunk_ids: splitTags(r.fields.related_chunk_ids),
  };
}

// Active chunks whose related_chunk_ids overlap the given result ids
// (replaces .overlaps("related_chunk_ids", resultIds)).
export async function getIncomingLinks(redis: RedisClient, resultIds: string[]): Promise<LinkedRow[]> {
  if (resultIds.length === 0) return [];
  const query = `@status:{active} @related_chunk_ids:{${resultIds.map(escapeTag).join("|")}}`;
  const reply = await redis.sendCommand([
    "FT.SEARCH", idx.chunks, query, "LIMIT", "0", "200",
    "RETURN", String(READ_FIELDS.length), ...READ_FIELDS,
    "DIALECT", "2",
  ]);
  return parseSearch(reply).map(toLinkedRow);
}

// Fetch specific active chunks by id (for outgoing links).
export async function getActiveChunksByIds(redis: RedisClient, ids: string[]): Promise<LinkedRow[]> {
  if (ids.length === 0) return [];
  // The chunk id is the document key, not an indexed field, so fetch by key.
  const rows = await Promise.all(
    ids.map(async (id) => {
      const reply = (await redis.sendCommand([
        "HMGET", k.chunk(id), ...READ_FIELDS,
      ])) as unknown[];
      const fields: Record<string, string> = {};
      READ_FIELDS.forEach((f, i) => {
        const v = reply?.[i];
        if (v != null) fields[f] = bufToStr(v);
      });
      if (!fields.content || fields.status !== "active") return null;
      return toLinkedRow({ id, fields });
    })
  );
  return rows.filter((r): r is LinkedRow => r !== null);
}

// Most recent session_summary chunks across the searched KBs.
export async function getRecentSummaries(
  redis: RedisClient,
  kbIds: string[],
  limit: number
): Promise<SummaryRow[]> {
  if (kbIds.length === 0) return [];
  const query = `${tagIn("knowledge_base_id", kbIds)} @chunk_type:{session_summary} @status:{active}`;
  const reply = await redis.sendCommand([
    "FT.SEARCH", idx.chunks, query,
    "SORTBY", "valid_from", "DESC",
    "LIMIT", "0", String(limit),
    "RETURN", String(READ_FIELDS.length), ...READ_FIELDS,
    "DIALECT", "2",
  ]);
  return parseSearch(reply).map((r) => ({
    ...toLinkedRow(r),
    valid_from: msToIso(r.fields.valid_from),
    valid_to: msToIso(r.fields.valid_to),
  }));
}

// ---- commit-path mutations -----------------------------------------

// Update a chunk's related_chunk_ids (label→UUID resolution after insert).
export async function updateRelatedChunkIds(
  redis: RedisClient,
  id: string,
  relatedIds: string[]
): Promise<void> {
  await redis.sendCommand([
    "HSET",
    k.chunk(id),
    "related_chunk_ids",
    relatedIds.join("|"),
    "updated_at",
    String(Date.now()),
  ]);
}

// Supersede prior active continuity chunks (chunk_type=state) whose topic_tags
// overlap the given tags. Replaces the reference's
// .eq(status,active).eq(chunk_type,state).overlaps(topic_tags, [...]) update.
export async function supersedeContinuityChunks(
  redis: RedisClient,
  kbId: string,
  tags: string[],
  validToIso: string
): Promise<number> {
  if (tags.length === 0) return 0;
  const query = `@knowledge_base_id:{${escapeTag(kbId)}} @status:{active} @chunk_type:{state} @topic_tags:{${tags
    .map(escapeTag)
    .join("|")}}`;
  const reply = await redis.sendCommand([
    "FT.SEARCH", idx.chunks, query, "NOCONTENT", "LIMIT", "0", "1000", "DIALECT", "2",
  ]);
  const ids = parseSearchKeys(reply);
  if (ids.length > 0) await markSuperseded(redis, ids, validToIso);
  return ids.length;
}

// ---- check_updates history -----------------------------------------

export interface HistoryRow {
  id: string;
  knowledge_base_id: string;
  content: string;
  chunk_type: string;
  created_at: string | null;
  valid_to: string | null;
}

function toHistoryRow(r: { id: string; fields: Record<string, string> }): HistoryRow {
  return {
    id: r.id,
    knowledge_base_id: r.fields.knowledge_base_id ?? "",
    content: r.fields.content ?? "",
    chunk_type: r.fields.chunk_type ?? "",
    created_at: msToIso(r.fields.created_at),
    valid_to: msToIso(r.fields.valid_to),
  };
}

// Active chunks created at/after sinceMs (newest first). Optional KB filter.
export async function getChunksCreatedSince(
  redis: RedisClient,
  sinceMs: number,
  kbIds: string[] | undefined,
  limit: number
): Promise<HistoryRow[]> {
  const parts = ["@status:{active}", `@created_at:[${sinceMs} +inf]`];
  if (kbIds && kbIds.length > 0) parts.push(tagIn("knowledge_base_id", kbIds));
  const reply = await redis.sendCommand([
    "FT.SEARCH", idx.chunks, parts.join(" "),
    "SORTBY", "created_at", "DESC",
    "LIMIT", "0", String(limit),
    "RETURN", String(READ_FIELDS.length), ...READ_FIELDS,
    "DIALECT", "2",
  ]);
  return parseSearch(reply).map(toHistoryRow);
}

// Superseded chunks whose validity closed at/after sinceMs (newest first).
export async function getChunksSupersededSince(
  redis: RedisClient,
  sinceMs: number,
  limit: number
): Promise<HistoryRow[]> {
  const query = `@status:{superseded} @valid_to:[${sinceMs} +inf]`;
  const reply = await redis.sendCommand([
    "FT.SEARCH", idx.chunks, query,
    "SORTBY", "valid_to", "DESC",
    "LIMIT", "0", String(limit),
    "RETURN", String(READ_FIELDS.length), ...READ_FIELDS,
    "DIALECT", "2",
  ]);
  return parseSearch(reply).map(toHistoryRow);
}

// ---- KB deletion (batched, replaces cascade) -----------------------

export async function deleteChunksByKb(redis: RedisClient, kbId: string): Promise<number> {
  const ids = await redis.sMembers(k.kbChunks(kbId));
  if (ids.length > 0) {
    await Promise.all(ids.map((id) => redis.del(k.chunk(id))));
  }
  await redis.del(k.kbChunks(kbId));
  return ids.length;
}

// ============================================================
// Dashboard chunk operations (phase 6) — paginated listing, single-chunk
// fetch/edit/archive, and document-scoped reads. These power the workspace KB
// browser, the chunk editor, and document management.
// ============================================================

const LIST_FIELDS = [
  "knowledge_base_id",
  "content",
  "chunk_type",
  "topic_tags",
  "related_chunk_ids",
  "source_type",
  "source_document_id",
  "status",
  "created_by",
  "session_id",
  "created_at",
  "updated_at",
];

export interface FullChunk {
  id: string;
  knowledge_base_id: string;
  content: string;
  chunk_type: string;
  topic_tags: string[];
  related_chunk_ids: string[];
  source_type: string;
  source_document_id: string | null;
  status: string;
  created_by: string | null;
  session_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function toFullChunk(r: { id: string; fields: Record<string, string> }): FullChunk {
  return {
    id: r.id,
    knowledge_base_id: r.fields.knowledge_base_id ?? "",
    content: r.fields.content ?? "",
    chunk_type: r.fields.chunk_type ?? "",
    topic_tags: splitTags(r.fields.topic_tags),
    related_chunk_ids: splitTags(r.fields.related_chunk_ids),
    source_type: r.fields.source_type ?? "session",
    source_document_id: r.fields.source_document_id || null,
    status: r.fields.status ?? "active",
    created_by: r.fields.created_by || null,
    session_id: r.fields.session_id || null,
    created_at: msToIso(r.fields.created_at),
    updated_at: msToIso(r.fields.updated_at),
  };
}

export interface ListChunksParams {
  kbId: string;
  offset: number;
  limit: number;
  status?: string; // 'active' (default) | 'all' | any status
  chunkType?: string;
  topicTags?: string[];
  search?: string;
}

// Paginated chunk list with filters. Mirrors the reference's
// GET /workspaces/:id/knowledge-bases/:kbId/chunks query (status/type/tags/
// search + range), returning total for the pager.
export async function listChunksByKb(
  redis: RedisClient,
  p: ListChunksParams
): Promise<{ chunks: FullChunk[]; total: number }> {
  const parts = [`@knowledge_base_id:{${escapeTag(p.kbId)}}`];
  if (!p.status || p.status !== "all") {
    parts.push(`@status:{${escapeTag(p.status ?? "active")}}`);
  }
  if (p.chunkType) parts.push(`@chunk_type:{${escapeTag(p.chunkType)}}`);
  if (p.topicTags && p.topicTags.length > 0) {
    parts.push(`@topic_tags:{${p.topicTags.map(escapeTag).join("|")}}`);
  }
  if (p.search && p.search.trim()) {
    const tokens = p.search.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
    if (tokens.length > 0) parts.push(`@content:(${tokens.join(" ")})`);
  }
  const query = parts.join(" ");
  const reply = await redis.sendCommand([
    "FT.SEARCH", idx.chunks, query,
    "SORTBY", "created_at", "DESC",
    "LIMIT", String(p.offset), String(p.limit),
    "RETURN", String(LIST_FIELDS.length), ...LIST_FIELDS,
    "DIALECT", "2",
  ]);
  return { chunks: parseSearch(reply).map(toFullChunk), total: searchCount(reply) };
}

// topic_key for a set of chunk ids (super-commit conflict candidates). Absent
// ids map to null. Mirrors the reference's `select id, topic_key in (...)`.
export async function getTopicKeys(
  redis: RedisClient,
  ids: string[]
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  for (const id of ids) {
    const tk = (await redis.hGet(k.chunk(id), "topic_key")) as string | null;
    map.set(id, tk || null);
  }
  return map;
}

export async function getChunkById(redis: RedisClient, id: string): Promise<FullChunk | null> {
  const reply = (await redis.sendCommand(["HMGET", k.chunk(id), ...LIST_FIELDS])) as unknown[];
  const fields: Record<string, string> = {};
  LIST_FIELDS.forEach((f, i) => {
    const v = reply?.[i];
    if (v != null) fields[f] = bufToStr(v);
  });
  if (!fields.content && !fields.chunk_type) return null;
  return toFullChunk({ id, fields });
}

// Edit a chunk's content (+ re-embed) and/or chunk_type/topic_tags. The caller
// passes a fresh embedding only when content changed.
export async function updateChunk(
  redis: RedisClient,
  id: string,
  fields: { content?: string; chunk_type?: string; topic_tags?: string[]; embedding?: number[] }
): Promise<FullChunk | null> {
  const args: string[] = [];
  if (fields.content != null) args.push("content", fields.content);
  if (fields.chunk_type != null) args.push("chunk_type", fields.chunk_type);
  if (fields.topic_tags != null) args.push("topic_tags", fields.topic_tags.join("|"));
  args.push("updated_at", String(Date.now()));
  await redis.sendCommand(["HSET", k.chunk(id), ...args]);
  if (fields.embedding) {
    await redis.sendCommand(["HSET", k.chunk(id), "embedding", floatBuf(fields.embedding)]);
  }
  return getChunkById(redis, id);
}

// Soft-archive a single chunk (status='archived'). Returns false if absent.
export async function archiveChunk(
  redis: RedisClient,
  kbId: string,
  chunkId: string
): Promise<boolean> {
  const existingKb = (await redis.hGet(k.chunk(chunkId), "knowledge_base_id")) as string | null;
  if (existingKb !== kbId) return false;
  await redis.sendCommand([
    "HSET", k.chunk(chunkId), "status", "archived", "updated_at", String(Date.now()),
  ]);
  return true;
}

// Active chunks produced by a given document (source_document_id), oldest first.
export async function getActiveChunksByDocument(
  redis: RedisClient,
  documentId: string
): Promise<FullChunk[]> {
  const query = `@source_document_id:{${escapeTag(documentId)}} @status:{active}`;
  const reply = await redis.sendCommand([
    "FT.SEARCH", idx.chunks, query,
    "SORTBY", "created_at", "ASC",
    "LIMIT", "0", "1000",
    "RETURN", String(LIST_FIELDS.length), ...LIST_FIELDS,
    "DIALECT", "2",
  ]);
  return parseSearch(reply).map(toFullChunk);
}

// Hard-delete every chunk produced by a document (the reference deletes
// document chunks outright rather than archiving them).
export async function deleteChunksByDocument(
  redis: RedisClient,
  kbId: string,
  documentId: string
): Promise<number> {
  const query = `@source_document_id:{${escapeTag(documentId)}}`;
  const reply = await redis.sendCommand([
    "FT.SEARCH", idx.chunks, query, "NOCONTENT", "LIMIT", "0", "10000", "DIALECT", "2",
  ]);
  const ids = parseSearchKeys(reply);
  if (ids.length > 0) {
    await Promise.all(ids.map((id) => redis.del(k.chunk(id))));
    await Promise.all(ids.map((id) => redis.sRem(k.kbChunks(kbId), id)));
  }
  return ids.length;
}

// Active chunks for a KB copy (content + metadata, no embedding — the copy
// route re-embeds the identical content). Paged internally to bound memory.
export async function getActiveChunksForCopy(
  redis: RedisClient,
  kbId: string
): Promise<Array<{ content: string; chunk_type: string; topic_tags: string[]; source_type: string }>> {
  const query = `@knowledge_base_id:{${escapeTag(kbId)}} @status:{active}`;
  const out: Array<{ content: string; chunk_type: string; topic_tags: string[]; source_type: string }> = [];
  const PAGE = 200;
  let offset = 0;
  for (;;) {
    const reply = await redis.sendCommand([
      "FT.SEARCH", idx.chunks, query,
      "LIMIT", String(offset), String(PAGE),
      "RETURN", "4", "content", "chunk_type", "topic_tags", "source_type",
      "DIALECT", "2",
    ]);
    const rows = parseSearch(reply);
    if (rows.length === 0) break;
    for (const r of rows) {
      out.push({
        content: r.fields.content ?? "",
        chunk_type: r.fields.chunk_type ?? "reference",
        topic_tags: splitTags(r.fields.topic_tags),
        source_type: r.fields.source_type ?? "session",
      });
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}
