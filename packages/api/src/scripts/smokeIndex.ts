import "../loadEnv.js";

import { connectRedis } from "../lib/redis.js";
import { ensureRedisInfra, EMBEDDING_DIM } from "../lib/indexes.js";
import { idx, k } from "../lib/keys.js";
import { escapeTag, floatBuf } from "../lib/search.js";

// End-to-end proof that idx:chunks works for BOTH vector KNN and BM25 text —
// the phase 2 -> 3 make-or-break. Uses random vectors (no OpenAI needed),
// then cleans up after itself.

function randVec(dim: number): number[] {
  return Array.from({ length: dim }, () => Math.random() * 2 - 1);
}

function stringifyReply(reply: unknown): unknown {
  if (Buffer.isBuffer(reply)) return reply.toString("utf8");
  if (Array.isArray(reply)) return reply.map(stringifyReply);
  return reply;
}

async function main() {
  const redis = await connectRedis();
  await ensureRedisInfra(redis);

  // Hyphens make this a good escaping test — real KB ids are hyphenated UUIDs.
  const SMOKE_KB = "smoke-kb-0000";
  const kbTag = escapeTag(SMOKE_KB);
  const now = Date.now();

  // Two chunks. queryVec == vecA exactly, so KNN must rank A first.
  const vecA = randVec(EMBEDDING_DIM);
  const vecB = randVec(EMBEDDING_DIM);
  const idA = "smoke-aaaa";
  const idB = "smoke-bbbb";

  await redis.sendCommand([
    "HSET", k.chunk(idA),
    "knowledge_base_id", SMOKE_KB,
    "chunk_type", "decision",
    "status", "active",
    "topic_tags", "redis|architecture",
    "content", "Decision: use Redis Stack with RediSearch for vector and full-text search",
    "created_at", String(now),
    "valid_from", String(now),
    "embedding", floatBuf(vecA),
  ]);
  await redis.sendCommand([
    "HSET", k.chunk(idB),
    "knowledge_base_id", SMOKE_KB,
    "chunk_type", "finding",
    "status", "active",
    "topic_tags", "postgres",
    "content", "Finding: Postgres pgvector HNSW index handles cosine similarity well",
    "created_at", String(now),
    "valid_from", String(now),
    "embedding", floatBuf(vecB),
  ]);

  // 1) Vector KNN, prefiltered to the smoke KB + active status.
  const knn = await redis.sendCommand([
    "FT.SEARCH", idx.chunks,
    `(@knowledge_base_id:{${kbTag}} @status:{active})=>[KNN 5 @embedding $BLOB AS vec_score]`,
    "PARAMS", "2", "BLOB", floatBuf(vecA),
    "SORTBY", "vec_score", "ASC",
    "RETURN", "2", "content", "vec_score",
    "DIALECT", "2",
  ]);

  // 2) BM25 full-text search.
  const bm25 = await redis.sendCommand([
    "FT.SEARCH", idx.chunks,
    `@knowledge_base_id:{${kbTag}} @content:redisearch`,
    "SCORER", "BM25", "WITHSCORES",
    "RETURN", "1", "content",
    "DIALECT", "2",
  ]);

  // 3) TAG filter (topic_tags multi-value).
  const tag = await redis.sendCommand([
    "FT.SEARCH", idx.chunks,
    `@knowledge_base_id:{${kbTag}} @topic_tags:{${escapeTag("architecture")}}`,
    "RETURN", "1", "content",
    "DIALECT", "2",
  ]);

  console.log("\n=== KNN (expect smoke-aaaa first, vec_score ~0) ===");
  console.log(JSON.stringify(stringifyReply(knn), null, 2));
  console.log("\n=== BM25 @content:redisearch (expect 1 hit: the Redis decision) ===");
  console.log(JSON.stringify(stringifyReply(bm25), null, 2));
  console.log("\n=== TAG @topic_tags:{architecture} (expect 1 hit) ===");
  console.log(JSON.stringify(stringifyReply(tag), null, 2));

  // Cleanup
  await redis.del(k.chunk(idA));
  await redis.del(k.chunk(idB));
  console.log("\n[smoke] cleaned up dummy chunks. PASS if each section returned its expected hit.");

  await redis.quit();
}

main().catch((err) => {
  console.error("[smoke] FAILED:", err);
  process.exit(1);
});
