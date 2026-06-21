import "../loadEnv.js";

import { connectRedis } from "../lib/redis.js";
import { ensureRedisInfra } from "../lib/indexes.js";
import { createKb } from "../lib/kbRepo.js";
import { storeChunks, deleteKnowledgeBase } from "../services/chunkService.js";
import { recall } from "../services/recallService.js";
import type { CommitChunkInput } from "../lib/types.js";

// Full core-engine proof (uses real OpenAI embeddings):
//   1. commit a batch of typed chunks (dedup + topic_key paths)
//   2. hybrid recall and show ranked results
//   3. commit again with the same topic_key -> deterministic supersession
//   4. recall again to confirm the new fact is current and the old one is gone
//   5. clean up the KB

function show(label: string, res: Awaited<ReturnType<typeof recall>>) {
  console.log(`\n=== recall: "${label}" ===`);
  res.chunks.slice(0, 6).forEach((c, i) => {
    console.log(
      `  ${i + 1}. [${c.chunk_type}] sim=${c.similarity.toFixed(3)} rrf=${c.rrf_score.toFixed(5)}  ${c.content.slice(0, 80)}`
    );
  });
  if (res.applied_chunk_type_filter) console.log(`  (applied chunk_type filter: ${res.applied_chunk_type_filter})`);
}

async function main() {
  const redis = await connectRedis();
  await ensureRedisInfra(redis);

  const userId = "smoke-user";
  const sessionId1 = "smoke-session-1";
  const kb = await createKb(redis, {
    workspace_id: "smoke-ws",
    name: "ContextMaster Smoke KB",
    description: "Throwaway KB for the phase 3 engine smoke test",
    kb_type: "software",
  });
  console.log(`[smoke] created KB ${kb.id}`);

  const validFrom1 = new Date().toISOString();
  const chunks1: CommitChunkInput[] = [
    { content: "Decision: Use Redis Stack as the all-in datastore, replacing Supabase and Postgres", chunk_type: "decision", topic_tags: ["redis", "architecture"], topic_key: "primary-datastore" },
    { content: "Finding: RediSearch HNSW handles 1536-dimension cosine vectors with sub-millisecond KNN latency", chunk_type: "finding", topic_tags: ["redisearch", "performance"] },
    { content: "Convention: All Redis keys are namespaced under the cm: prefix", chunk_type: "convention", topic_tags: ["redis", "conventions"] },
    { content: "State: The API server listens on port 3001 locally", chunk_type: "state", topic_tags: ["api"], topic_key: "api-port" },
    // Near-duplicate of the first decision (same chunk_type) — should collapse via in-batch dedup.
    { content: "Decision: Adopt Redis Stack as the single datastore, replacing Supabase/Postgres", chunk_type: "decision", topic_tags: ["redis"], topic_key: "primary-datastore" },
  ];

  const res1 = await storeChunks(kb.id, chunks1, userId, sessionId1, validFrom1);
  console.log(`[smoke] commit 1: ${JSON.stringify(res1.chunkMap.length ? { stored: res1.stored, deduplicated: res1.deduplicated, superseded: res1.superseded } : res1)}`);

  show("what datastore are we using", await recall({ query: "what datastore are we using", knowledgeBaseIds: [kb.id], userId }));
  show("what conventions do we follow", await recall({ query: "what conventions do we follow", knowledgeBaseIds: [kb.id], userId }));

  // ---- supersession: same topic_key, new value, later session ----
  const sessionId2 = "smoke-session-2";
  const validFrom2 = new Date(Date.now() + 1000).toISOString();
  const chunks2: CommitChunkInput[] = [
    { content: "Decision: Use Redis Cloud (not local Docker) as the datastore for the hackathon demo", chunk_type: "decision", topic_tags: ["redis", "deployment"], topic_key: "primary-datastore" },
  ];
  const res2 = await storeChunks(kb.id, chunks2, userId, sessionId2, validFrom2);
  console.log(`\n[smoke] commit 2 (topic_key=primary-datastore): stored=${res2.stored} superseded=${res2.superseded} (expect superseded>=1)`);

  show("what datastore are we using", await recall({ query: "what datastore are we using", knowledgeBaseIds: [kb.id], userId }));

  await deleteKnowledgeBase(kb.id, "smoke-ws");
  console.log("\n[smoke] cleaned up KB. PASS if recall ranked sensibly and commit 2 superseded the old datastore decision.");

  await redis.quit();
}

main().catch((err) => {
  console.error("[smoke] FAILED:", err);
  process.exit(1);
});
