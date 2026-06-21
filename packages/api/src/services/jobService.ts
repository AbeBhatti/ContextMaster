import { randomUUID } from "node:crypto";
import { getRedis } from "../lib/redis.js";
import { k, JOBS_GROUP } from "../lib/keys.js";

// Server-side extraction job queue. Replaces the reference's `processing_jobs`
// table + claim_next_job RPC with Redis Streams + a consumer group.
//
// Phase 4 wires the ENQUEUE + STATUS halves so save_session (POST
// /mcp/commit-raw) accepts work and GET /mcp/jobs/:id can report it. The
// consuming worker (XREADGROUP loop → GPT-4o-mini extraction → storeChunks)
// lands in phase 5; startWorker() is a logged no-op until then.

function msToIso(ms: string | null | undefined): string | null {
  if (!ms) return null;
  const n = Number(ms);
  return Number.isNaN(n) ? null : new Date(n).toISOString();
}

export interface JobStatus {
  id: string;
  user_id: string;
  knowledge_base_id: string | null;
  status: "queued" | "processing" | "completed" | "failed";
  chunks_created: number;
  chunks_deduplicated: number;
  chunks_superseded: number;
  extraction_model: string | null;
  extraction_ms: number | null;
  pipeline_ms: number | null;
  error_message: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  result_json: unknown | null;
}

export interface EnqueueJobInput {
  userId: string;
  knowledgeBaseId: string;
  conversationText: string;
  toolUsed?: string;
  processAfter?: string; // ISO; worker skips until this time (rate-limit deferral)
}

export async function enqueueJob(input: EnqueueJobInput): Promise<{ jobId: string }> {
  const redis = getRedis();
  const jobId = randomUUID();
  const now = Date.now();
  const processAfterMs = input.processAfter ? new Date(input.processAfter).getTime() : 0;

  const fields: string[] = [
    "id", jobId,
    "user_id", input.userId,
    "knowledge_base_id", input.knowledgeBaseId,
    "conversation_text", input.conversationText,
    "status", "queued",
    "chunks_created", "0",
    "chunks_deduplicated", "0",
    "chunks_superseded", "0",
    "process_after", String(processAfterMs),
    "created_at", String(now),
  ];
  if (input.toolUsed) fields.push("tool_used", input.toolUsed);

  await redis.sendCommand(["HSET", k.job(jobId), ...fields]);
  await redis.zAdd(k.userJobs(input.userId), { score: now, value: jobId });
  // The stream message carries just the id; the worker rehydrates from the
  // job hash. Mirrors the lightweight-claim pattern of the Postgres queue.
  await redis.sendCommand(["XADD", k.jobsStream, "*", "jobId", jobId]);

  return { jobId };
}

export async function getJobStatus(id: string): Promise<JobStatus | null> {
  const redis = getRedis();
  const h = (await redis.hGetAll(k.job(id))) as Record<string, string>;
  if (!h || Object.keys(h).length === 0) return null;

  let resultJson: unknown | null = null;
  if (h.result_json) {
    try {
      resultJson = JSON.parse(h.result_json);
    } catch {
      resultJson = null;
    }
  }

  return {
    id,
    user_id: h.user_id ?? "",
    knowledge_base_id: h.knowledge_base_id ?? null,
    status: (h.status as JobStatus["status"]) ?? "queued",
    chunks_created: Number(h.chunks_created ?? 0),
    chunks_deduplicated: Number(h.chunks_deduplicated ?? 0),
    chunks_superseded: Number(h.chunks_superseded ?? 0),
    extraction_model: h.extraction_model ?? null,
    extraction_ms: h.extraction_ms ? Number(h.extraction_ms) : null,
    pipeline_ms: h.pipeline_ms ? Number(h.pipeline_ms) : null,
    error_message: h.error_message ?? null,
    created_at: msToIso(h.created_at),
    started_at: msToIso(h.started_at),
    completed_at: msToIso(h.completed_at),
    result_json: resultJson,
  };
}

// Count of this user's jobs created within the last `windowMs` — used by the
// commit-raw rate limiter. Reads the userJobs sorted set by created_at score.
export async function countRecentJobs(userId: string, windowMs: number): Promise<number> {
  const redis = getRedis();
  const since = Date.now() - windowMs;
  const ids = (await redis.sendCommand([
    "ZRANGEBYSCORE",
    k.userJobs(userId),
    String(since),
    "+inf",
  ])) as string[];
  return ids?.length ?? 0;
}

export async function oldestJobInWindow(userId: string, windowMs: number): Promise<number | null> {
  const redis = getRedis();
  const since = Date.now() - windowMs;
  const ids = (await redis.sendCommand([
    "ZRANGEBYSCORE",
    k.userJobs(userId),
    String(since),
    "+inf",
    "LIMIT",
    "0",
    "1",
  ])) as string[];
  if (!ids || ids.length === 0) return null;
  const score = (await redis.zScore(k.userJobs(userId), ids[0])) as number | null;
  return score ?? null;
}

// Phase 5 replaces this with a real XREADGROUP consumer loop. Kept here so
// index.ts can call startWorker() unconditionally and the wiring is in place.
export function startWorker(): void {
  void JOBS_GROUP;
  console.log(
    "[jobs] enqueue + status ready (Redis Streams). Worker/extraction pipeline lands in phase 5."
  );
}
