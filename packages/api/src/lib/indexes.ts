import type { RedisClient } from "./redis.js";
import { idx, chunkPrefix, kbPrefix, k, JOBS_GROUP } from "./keys.js";

// Embedding dimensionality. text-embedding-3-small = 1536, matching the
// reference's vector(1536) columns and pgvector HNSW cosine index.
export const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIMENSIONS || 1536);

// HNSW build params chosen to mirror the reference's pgvector HNSW intent
// (m=16, ef_construction=64). RediSearch defaults to M=16/EF_CONSTRUCTION=200;
// we pin EF_CONSTRUCTION=64 for parity. Distance metric COSINE matches
// vector_cosine_ops + the `1 - (a <=> b)` similarity the RPCs compute.
const HNSW_M = "16";
const HNSW_EF_CONSTRUCTION = "64";

function vectorFieldArgs(fieldName: string): string[] {
  return [
    fieldName,
    "VECTOR",
    "HNSW",
    "10", // number of attribute args that follow (5 key/value pairs)
    "TYPE",
    "FLOAT32",
    "DIM",
    String(EMBEDDING_DIM),
    "DISTANCE_METRIC",
    "COSINE",
    "M",
    HNSW_M,
    "EF_CONSTRUCTION",
    HNSW_EF_CONSTRUCTION,
  ];
}

async function createIndexIfMissing(redis: RedisClient, args: string[]): Promise<"created" | "exists"> {
  try {
    await redis.sendCommand(args);
    return "created";
  } catch (err) {
    const msg = (err as Error).message || "";
    if (/index already exists/i.test(msg)) return "exists";
    throw err;
  }
}

// idx:chunks — the Redis analogue of knowledge_chunks + its pgvector HNSW
// index + the content_tsv GIN index. One RediSearch index gives us vector KNN
// AND BM25 full-text AND secondary TAG/NUMERIC filtering over the same hashes.
async function createChunksIndex(redis: RedisClient): Promise<"created" | "exists"> {
  const args = [
    "FT.CREATE",
    idx.chunks,
    "ON",
    "HASH",
    "PREFIX",
    "1",
    chunkPrefix,
    "SCHEMA",
    // Equality / IN filters (replace PostgREST .eq / .in and the SQL WHEREs)
    "knowledge_base_id", "TAG",
    "chunk_type", "TAG",
    "status", "TAG",
    "session_id", "TAG",
    "topic_key", "TAG", // deterministic supersession lookup (Stage 4)
    "source_type", "TAG",
    "source_document_id", "TAG",
    "created_by", "TAG",
    // Array columns (replace Postgres TEXT[]/UUID[] + GIN .overlaps)
    "topic_tags", "TAG", "SEPARATOR", "|",
    "related_chunk_ids", "TAG", "SEPARATOR", "|",
    // BM25 full-text (replace to_tsvector('english') + ts_rank_cd). RediSearch
    // applies english stemming by default; we pass SCORER BM25 at query time.
    "content", "TEXT",
    // Bi-temporal + recency (epoch millis). SORTABLE powers temporal rerank.
    "valid_from", "NUMERIC", "SORTABLE",
    "valid_to", "NUMERIC", "SORTABLE",
    "created_at", "NUMERIC", "SORTABLE",
    // Vector KNN (replace pgvector embedding <=> query)
    ...vectorFieldArgs("embedding"),
  ];
  return createIndexIfMissing(redis, args);
}

// idx:kbs — the Redis analogue of knowledge_bases.description_embedding HNSW
// index, powering match_knowledge_bases (Tier 2 KB routing).
async function createKbsIndex(redis: RedisClient): Promise<"created" | "exists"> {
  const args = [
    "FT.CREATE",
    idx.kbs,
    "ON",
    "HASH",
    "PREFIX",
    "1",
    kbPrefix,
    "SCHEMA",
    "workspace_id", "TAG",
    "kb_type", "TAG",
    "name", "TEXT",
    "description", "TEXT",
    "chunk_count", "NUMERIC", "SORTABLE",
    "created_at", "NUMERIC", "SORTABLE",
    // Only KBs that have a description_embedding participate in KNN — mirrors
    // the reference's `WHERE description_embedding IS NOT NULL`.
    ...vectorFieldArgs("description_embedding"),
  ];
  return createIndexIfMissing(redis, args);
}

// Streams consumer group for server-side extraction jobs. Replaces the
// Postgres processing_jobs queue + claim_next_job (FOR UPDATE SKIP LOCKED):
// XREADGROUP gives each job to exactly one worker, XACK marks it done, and
// XAUTOCLAIM recovers jobs from workers that died mid-flight.
async function createJobsGroup(redis: RedisClient): Promise<"created" | "exists"> {
  try {
    // MKSTREAM creates the stream if it doesn't exist yet. "$" = only deliver
    // jobs enqueued after the group is created (the group is created on boot,
    // before the API accepts any commit-raw requests).
    await redis.sendCommand(["XGROUP", "CREATE", k.jobsStream, JOBS_GROUP, "$", "MKSTREAM"]);
    return "created";
  } catch (err) {
    const msg = (err as Error).message || "";
    if (/BUSYGROUP/i.test(msg)) return "exists";
    throw err;
  }
}

// Idempotent bootstrap run on every API start (and after each reconnect).
export async function ensureRedisInfra(redis: RedisClient): Promise<void> {
  const chunks = await createChunksIndex(redis);
  const kbs = await createKbsIndex(redis);
  const jobs = await createJobsGroup(redis);
  console.log(
    `[redis] infra ready — ${idx.chunks} (${chunks}), ${idx.kbs} (${kbs}), jobs group ${JOBS_GROUP} (${jobs})`
  );
}

// Lightweight check for /health: which indexes currently exist.
export async function listIndexes(redis: RedisClient): Promise<string[]> {
  const res = (await redis.sendCommand(["FT._LIST"])) as unknown;
  if (Array.isArray(res)) return res.map((x) => (Buffer.isBuffer(x) ? x.toString() : String(x)));
  return [];
}
