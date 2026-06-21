import { randomUUID } from "node:crypto";
import { getRedis } from "../lib/redis.js";
import { k, JOBS_GROUP } from "../lib/keys.js";
import { storeChunks, storeChunksRaw } from "./chunkService.js";
import {
  extractEntities,
  checkCoverage,
  generateSupplementaryChunks,
} from "./entityExtractor.js";
import {
  extractFromConversation,
  isExtractionConfigured,
  type ExtractionChunk,
  type ExtractionTimings,
} from "./extractionService.js";
import { routeCommit, updateKbDescription } from "./routingService.js";
import { track } from "../lib/analytics.js";
import * as sessionRepo from "../lib/sessionRepo.js";
import * as chunkRepo from "../lib/chunkRepo.js";
import * as kbRepo from "../lib/kbRepo.js";
import type { CommitChunkInput } from "../lib/types.js";

// Server-side extraction job queue, Redis-native.
//
// Replaces the reference's `processing_jobs` table + claim_next_job RPC
// (FOR UPDATE SKIP LOCKED) with a Redis Stream + consumer group:
//   • enqueueJob   → XADD cm:jobs:stream  (+ a cm:job:{id} state hash)
//   • the worker   → XREADGROUP > claims new jobs; XACK + XDEL on done
//   • stale/defer  → XAUTOCLAIM re-surfaces messages idle past the threshold,
//                    which doubles as crashed-worker recovery AND the periodic
//                    re-check for rate-limit-deferred jobs (process_after).
//
// The extraction→commit pipeline below mirrors POST /mcp/commit byte-for-byte
// (minus super-commit) so a save_session job lands identical chunks to a
// save_memory call.

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
    "retry_count", "0",
    "process_after", String(processAfterMs),
    "created_at", String(now),
  ];
  if (input.toolUsed) fields.push("tool_used", input.toolUsed);

  await redis.sendCommand(["HSET", k.job(jobId), ...fields]);
  await redis.zAdd(k.userJobs(input.userId), { score: now, value: jobId });
  // Index under the (initial) KB so the dashboard can list a workspace's jobs
  // by KB. Deferred-routing jobs get re-indexed under the routed KB in the
  // pipeline below.
  await redis.zAdd(k.kbJobs(input.knowledgeBaseId), { score: now, value: jobId });
  // The stream message carries just the id; the worker rehydrates from the
  // job hash. Mirrors the lightweight-claim pattern of the Postgres queue.
  await redis.sendCommand(["XADD", k.jobsStream, "*", "jobId", jobId]);

  console.log(
    `[job-queue] enqueued job=${jobId} kb=${input.knowledgeBaseId} user=${input.userId} chars=${input.conversationText.length}${
      input.processAfter ? ` process_after=${input.processAfter}` : ""
    }`
  );
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

// Full job record for the dashboard (includes conversation_text + tool_used +
// result_json + dedup/superseded counts). Returns the raw hash shaped for the
// reference's GET /api/jobs/:id + /workspaces/:id/jobs responses.
export interface JobDetail {
  id: string;
  user_id: string;
  knowledge_base_id: string;
  status: string;
  tool_used: string | null;
  chunks_created: number | null;
  chunks_deduplicated: number | null;
  chunks_superseded: number | null;
  extraction_model: string | null;
  extraction_ms: number | null;
  pipeline_ms: number | null;
  error_message: string | null;
  result_json: unknown | null;
  conversation_text: string;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export async function getJobDetail(id: string): Promise<JobDetail | null> {
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
    knowledge_base_id: h.knowledge_base_id ?? "",
    status: h.status ?? "queued",
    tool_used: h.tool_used ?? null,
    chunks_created: h.chunks_created ? Number(h.chunks_created) : 0,
    chunks_deduplicated: h.chunks_deduplicated ? Number(h.chunks_deduplicated) : 0,
    chunks_superseded: h.chunks_superseded ? Number(h.chunks_superseded) : 0,
    extraction_model: h.extraction_model ?? null,
    extraction_ms: h.extraction_ms ? Number(h.extraction_ms) : null,
    pipeline_ms: h.pipeline_ms ? Number(h.pipeline_ms) : null,
    error_message: h.error_message ?? null,
    result_json: resultJson,
    conversation_text: h.conversation_text ?? "",
    created_at: msToIso(h.created_at),
    started_at: msToIso(h.started_at),
    completed_at: msToIso(h.completed_at),
  };
}

// Jobs across the given KBs, newest first, with paging — powers the dashboard
// workspace jobs list. Merges the per-KB sorted sets (kbJobs).
export async function listJobsByKbs(
  kbIds: string[],
  opts: { status?: string; limit: number; offset: number }
): Promise<{ jobs: JobDetail[]; total: number }> {
  if (kbIds.length === 0) return { jobs: [], total: 0 };
  const redis = getRedis();
  const idSet = new Set<string>();
  for (const kbId of kbIds) {
    const ids = (await redis.sendCommand([
      "ZREVRANGE", k.kbJobs(kbId), "0", "-1",
    ])) as string[];
    for (const id of ids ?? []) idSet.add(id);
  }
  let jobs: JobDetail[] = [];
  for (const id of idSet) {
    const job = await getJobDetail(id);
    if (job) jobs.push(job);
  }
  if (opts.status && ["queued", "processing", "completed", "failed"].includes(opts.status)) {
    jobs = jobs.filter((j) => j.status === opts.status);
  }
  jobs.sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  });
  const total = jobs.length;
  return { jobs: jobs.slice(opts.offset, opts.offset + opts.limit), total };
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

// ============================================
// Worker — Redis Streams consumer group
// ============================================

const WORKER_POLL_MS = 2_000;
// XAUTOCLAIM min-idle: how long a delivered-but-unacked message waits before
// it's re-surfaced. Doubles as (a) crashed-worker recovery — analogue of the
// reference's 5-min stale-job sweep — and (b) the periodic re-check for jobs
// deferred via process_after. Single-worker dev never processes two ticks
// concurrently (workerRunning guard), so reclaiming our own pending message is
// safe. Bump this well above max extraction time for a multi-worker deploy.
const RECLAIM_MIN_IDLE_MS = 30_000;
const MAX_JOBS_PER_TICK = 10;
// One retry is enough in practice — failures that survive the simplified
// prompt are structural (bad input, missing key) and won't benefit from more.
const MAX_RETRY_COUNT = 1;

const CONSUMER = `worker-${process.pid}`;

interface WorkerJob {
  id: string;
  userId: string;
  knowledgeBaseId: string;
  conversationText: string;
  toolUsed: string;
  retryCount: number;
  status: string;
  processAfter: number;
}

function bufToStr(x: unknown): string {
  return Buffer.isBuffer(x) ? x.toString("utf8") : String(x ?? "");
}

// Parse the [ [id, [f,v,...]], ... ] entry list shared by XREADGROUP and
// XAUTOCLAIM into { messageId, jobId } pairs.
function parseStreamEntries(entries: unknown): Array<{ messageId: string; jobId: string }> {
  if (!Array.isArray(entries)) return [];
  const out: Array<{ messageId: string; jobId: string }> = [];
  for (const entry of entries) {
    if (!Array.isArray(entry)) continue;
    const messageId = bufToStr(entry[0]);
    const fieldArr = entry[1];
    let jobId = "";
    if (Array.isArray(fieldArr)) {
      for (let i = 0; i < fieldArr.length; i += 2) {
        if (bufToStr(fieldArr[i]) === "jobId") jobId = bufToStr(fieldArr[i + 1]);
      }
    }
    if (messageId && jobId) out.push({ messageId, jobId });
  }
  return out;
}

async function readNewMessages(count: number): Promise<Array<{ messageId: string; jobId: string }>> {
  if (count <= 0) return [];
  const redis = getRedis();
  const reply = await redis.sendCommand([
    "XREADGROUP", "GROUP", JOBS_GROUP, CONSUMER,
    "COUNT", String(count),
    "STREAMS", k.jobsStream, ">",
  ]);
  // RESP2: [ [ streamName, [ entries ] ] ]  | null when empty
  if (!Array.isArray(reply) || reply.length === 0) return [];
  const stream = reply[0];
  if (!Array.isArray(stream)) return [];
  return parseStreamEntries(stream[1]);
}

async function reclaimPending(count: number): Promise<Array<{ messageId: string; jobId: string }>> {
  const redis = getRedis();
  const reply = await redis.sendCommand([
    "XAUTOCLAIM", k.jobsStream, JOBS_GROUP, CONSUMER,
    String(RECLAIM_MIN_IDLE_MS), "0",
    "COUNT", String(count),
  ]);
  // RESP2 (Redis 7): [ cursor, [ entries ], [ deletedIds ] ]
  if (!Array.isArray(reply) || reply.length < 2) return [];
  return parseStreamEntries(reply[1]);
}

async function ackAndDelete(messageId: string): Promise<void> {
  const redis = getRedis();
  await redis.sendCommand(["XACK", k.jobsStream, JOBS_GROUP, messageId]);
  await redis.sendCommand(["XDEL", k.jobsStream, messageId]);
}

async function loadJob(jobId: string): Promise<WorkerJob | null> {
  const redis = getRedis();
  const h = (await redis.hGetAll(k.job(jobId))) as Record<string, string>;
  if (!h || Object.keys(h).length === 0) return null;
  return {
    id: jobId,
    userId: h.user_id ?? "",
    knowledgeBaseId: h.knowledge_base_id ?? "",
    conversationText: h.conversation_text ?? "",
    toolUsed: h.tool_used ?? "unknown",
    retryCount: Number(h.retry_count ?? 0),
    status: h.status ?? "queued",
    processAfter: Number(h.process_after ?? 0),
  };
}

async function setJobFields(jobId: string, fields: Record<string, string | number>): Promise<void> {
  const redis = getRedis();
  const flat: string[] = [];
  for (const [key, val] of Object.entries(fields)) flat.push(key, String(val));
  if (flat.length === 0) return;
  await redis.sendCommand(["HSET", k.job(jobId), ...flat]);
}

/**
 * Claim + run one message. Never throws — failures mark the job failed (or
 * re-queue for one simplified retry) so the worker keeps draining behind it.
 * Returns true if it did work the caller should count against the per-tick cap.
 */
async function handleMessage(messageId: string, jobId: string): Promise<boolean> {
  const job = await loadJob(jobId);
  if (!job) {
    // Orphaned stream entry (hash gone) — drop it.
    await ackAndDelete(messageId);
    return false;
  }
  if (job.status === "completed" || job.status === "failed") {
    // Already terminal (idempotent re-delivery) — drop it.
    await ackAndDelete(messageId);
    return false;
  }
  // Rate-limit deferral: not yet time. Leave the message PENDING (no ack) so
  // XAUTOCLAIM re-surfaces it after RECLAIM_MIN_IDLE_MS for another check.
  if (job.processAfter && job.processAfter > Date.now()) {
    return false;
  }

  const isRetryAttempt = job.retryCount > 0;
  console.log(
    `[job-queue] processing job=${job.id} kb=${job.knowledgeBaseId} user=${job.userId} tool=${job.toolUsed} retry=${job.retryCount}${
      isRetryAttempt ? " (simplified)" : ""
    }`
  );

  const pipelineStartedAt = Date.now();
  await setJobFields(jobId, { status: "processing", started_at: pipelineStartedAt });

  try {
    await runExtractionPipeline(job, pipelineStartedAt, isRetryAttempt);
    await ackAndDelete(messageId);
  } catch (err: any) {
    const message = err?.message ?? String(err);

    if (job.retryCount < MAX_RETRY_COUNT) {
      // First failure — bump the counter, re-queue a fresh stream message, and
      // drop the current one. Next tick runs the simplified prompt.
      console.warn(
        `[job-queue] job=${job.id} failed on attempt ${job.retryCount + 1}; re-queueing with simplified prompt:`,
        message
      );
      await setJobFields(jobId, {
        status: "queued",
        retry_count: job.retryCount + 1,
        started_at: "",
        error_message: `Attempt ${job.retryCount + 1} failed: ${message.slice(0, 1500)}`,
      });
      const redis = getRedis();
      await redis.sendCommand(["XADD", k.jobsStream, "*", "jobId", jobId]);
      await ackAndDelete(messageId);
    } else {
      console.error(
        `[job-queue] job=${job.id} permanently failed after ${job.retryCount + 1} attempts:`,
        message
      );
      await setJobFields(jobId, {
        status: "failed",
        error_message: `Permanent failure after ${job.retryCount + 1} attempts: ${message.slice(0, 1500)}`,
        completed_at: Date.now(),
        pipeline_ms: Date.now() - pipelineStartedAt,
      });
      track(job.userId, "mcp.save_session.failed", {
        knowledge_base_id: job.knowledgeBaseId,
        tool_used: job.toolUsed,
        error_message: message.slice(0, 500),
        retry_count: job.retryCount,
      });
      await ackAndDelete(messageId);
    }
  }
  return true;
}

let workerHandle: ReturnType<typeof setInterval> | null = null;
let workerRunning = false;

export function startWorker(): void {
  if (workerHandle) {
    console.warn("[job-queue] worker already started; ignoring duplicate call");
    return;
  }
  if (!isExtractionConfigured()) {
    console.warn(
      "[job-queue] OPENAI_API_KEY not configured — worker is started but every job will fail. Set OPENAI_API_KEY to enable extraction."
    );
  }

  console.log(`[job-queue] worker ${CONSUMER} started, polling every ${WORKER_POLL_MS}ms`);

  workerHandle = setInterval(async () => {
    // Prevent overlapping ticks — a slow extraction would otherwise stack up.
    if (workerRunning) return;
    workerRunning = true;
    try {
      let processed = 0;

      // 1. Re-surface stale/deferred pending messages (crashed-worker recovery
      //    + process_after re-check).
      const reclaimed = await reclaimPending(MAX_JOBS_PER_TICK);
      for (const m of reclaimed) {
        if (processed >= MAX_JOBS_PER_TICK) break;
        if (await handleMessage(m.messageId, m.jobId)) processed++;
      }

      // 2. Drain new jobs.
      if (processed < MAX_JOBS_PER_TICK) {
        const fresh = await readNewMessages(MAX_JOBS_PER_TICK - processed);
        for (const m of fresh) {
          await handleMessage(m.messageId, m.jobId);
        }
      }
    } catch (err: any) {
      console.error("[job-queue] worker tick error (continuing):", err?.message ?? err);
    } finally {
      workerRunning = false;
    }
  }, WORKER_POLL_MS);

  if (typeof workerHandle.unref === "function") workerHandle.unref();
}

export function stopWorker(): void {
  if (workerHandle) {
    clearInterval(workerHandle);
    workerHandle = null;
  }
}

// ============================================
// Extraction → commit pipeline replay
//
// Mirrors the chunk-flow POST /mcp/commit does inline, minus super-commit
// (server-side extraction IS the LLM verification). Stages match mcp.ts:
//   1. extractFromConversation() → chunks + summary
//   1.5 routeCommit() → semantic KB selection
//   2. session row (with conversation_text for re-extraction)
//   3. continuity chunks (next_steps / open_questions) + supersession
//   4. storeChunks with dedup
//   5. resolve related_to_labels → real UUIDs
//   6. update session + KB rows
//   7. mark job completed
//   8. analytics
//   9. background session_summary chunk
//   10. background entity coverage verification
//   11. background KB description regeneration
// ============================================

function toCommitChunkInput(chunk: ExtractionChunk): CommitChunkInput {
  return {
    content: chunk.content,
    chunk_type: chunk.chunk_type,
    topic_tags: chunk.topic_tags,
    label: chunk.label,
    related_to_labels: chunk.related_to_labels,
    topic_key: chunk.topic_key,
  };
}

async function runExtractionPipeline(
  job: WorkerJob,
  pipelineStartedAt: number,
  simplified: boolean
): Promise<void> {
  const redis = getRedis();
  const timings: Record<string, number> = {};
  let t0: number;

  // -------- Stage 1: extract --------
  const extractionStartedAt = Date.now();
  const extraction = await extractFromConversation({
    conversationText: job.conversationText,
    toolUsed: job.toolUsed,
    simplified,
  });
  const extractionMs = Date.now() - extractionStartedAt;

  if (extraction.chunks.length === 0 && !extraction.sessionSummary) {
    throw new Error("extraction produced no chunks and no summary");
  }

  // -------- Stage 1.5: semantic routing --------
  t0 = Date.now();
  let targetKbId = job.knowledgeBaseId;
  if (extraction.sessionSummary) {
    try {
      const routing = await routeCommit(
        extraction.sessionSummary,
        job.userId,
        job.knowledgeBaseId || undefined,
        undefined // name not available in job context
      );
      targetKbId = routing.kbId;
      if (targetKbId !== job.knowledgeBaseId) {
        // Re-index the job under the routed KB so the dashboard's per-KB job
        // list reflects where the chunks actually landed.
        await redis.zAdd(k.kbJobs(targetKbId), { score: Date.now(), value: job.id });
        console.log(
          `[job-queue] job=${job.id} routed from kb=${job.knowledgeBaseId} to kb=${targetKbId} (confidence=${routing.confidence.toFixed(3)}, created=${routing.wasCreated})`
        );
      }
    } catch (routeErr: any) {
      // Routing failure is non-fatal — fall back to the original KB id.
      console.warn(`[job-queue] routing failed for job=${job.id}, using original KB:`, routeErr?.message);
    }
  }
  timings.routing_ms = Date.now() - t0;

  // -------- Stage 2: session row --------
  t0 = Date.now();
  const session = await sessionRepo.createSession(redis, {
    user_id: job.userId,
    tool_used: job.toolUsed,
    knowledge_bases_used: [targetKbId],
    session_summary: extraction.sessionSummary,
    conversation_text: job.conversationText,
  });
  // Link session → job so dashboard history can offer View Conversation /
  // Re-extract on server-side rows (replaces the result_json->>session_id join).
  await sessionRepo.setSessionJob(redis, session.id, job.id);
  timings.session_insert_ms = Date.now() - t0;

  const sessionDate = session.created_at ?? new Date().toISOString();
  const datePrefix = `[${new Date(sessionDate).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })}] `;

  // -------- Stage 3: continuity chunks (next_steps / open_questions) --------
  t0 = Date.now();
  const nextStepsString = extraction.nextSteps
    .filter((s) => s && s.trim().length > 0)
    .map((s) => s.trim())
    .join("\n- ");
  const openQuestionsString = extraction.openQuestions
    .filter((s) => s && s.trim().length > 0)
    .map((s) => s.trim())
    .join("\n- ");

  const continuityChunks: ExtractionChunk[] = [];
  const continuityTagsToSupersede: string[] = [];
  if (nextStepsString) {
    continuityChunks.push({
      content: `Next steps:\n- ${nextStepsString}`,
      chunk_type: "state",
      topic_tags: ["next-steps", "continuity"],
      label: "next-steps",
    });
    continuityTagsToSupersede.push("next-steps");
  }
  if (openQuestionsString) {
    continuityChunks.push({
      content: `Open questions:\n- ${openQuestionsString}`,
      chunk_type: "state",
      topic_tags: ["open-questions", "continuity"],
      label: "open-questions",
    });
    continuityTagsToSupersede.push("open-questions");
  }

  if (continuityTagsToSupersede.length > 0) {
    await chunkRepo.supersedeContinuityChunks(redis, targetKbId, continuityTagsToSupersede, sessionDate);
  }
  timings.continuity_ms = Date.now() - t0;

  // -------- Stage 4: bulk store with dedup --------
  t0 = Date.now();
  const allInputChunks: CommitChunkInput[] = [
    ...extraction.chunks.map(toCommitChunkInput),
    ...continuityChunks.map(toCommitChunkInput),
  ].map((c) => ({
    ...c,
    content: c.content.startsWith("[") ? c.content : datePrefix + c.content,
  }));

  const result = await storeChunks(targetKbId, allInputChunks, job.userId, session.id, sessionDate);
  timings.chunk_storage_ms = Date.now() - t0;

  // -------- Stage 5: resolve related_to_labels → UUIDs --------
  t0 = Date.now();
  const labelToId = new Map<string, string>();
  for (const entry of result.chunkMap) {
    const inputChunk = allInputChunks[entry.index];
    if (inputChunk.label) labelToId.set(inputChunk.label, entry.id);
  }
  if (labelToId.size > 0) {
    const relatedUpdates: Promise<unknown>[] = [];
    for (const entry of result.chunkMap) {
      const inputChunk = allInputChunks[entry.index];
      const labels = inputChunk.related_to_labels;
      if (!labels?.length) continue;
      const resolved: string[] = [];
      for (const label of labels) {
        const id = labelToId.get(label);
        if (id && id !== entry.id) resolved.push(id);
      }
      if (resolved.length === 0) continue;
      const existing = inputChunk.related_to ?? [];
      const merged = Array.from(new Set([...existing, ...resolved]));
      relatedUpdates.push(chunkRepo.updateRelatedChunkIds(redis, entry.id, merged));
    }
    if (relatedUpdates.length > 0) await Promise.all(relatedUpdates);
  }
  timings.label_resolution_ms = Date.now() - t0;

  // -------- Stage 6: update session + KB rows --------
  t0 = Date.now();
  await sessionRepo.updateSessionCounts(redis, session.id, {
    chunks_added: result.stored,
    chunks_superseded: result.superseded,
  });

  const lastSessionSummary = [
    extraction.sessionSummary,
    nextStepsString ? `Next: ${nextStepsString}` : null,
    openQuestionsString ? `Open: ${openQuestionsString}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  await kbRepo.updateKb(redis, targetKbId, { last_session_summary: lastSessionSummary });
  timings.session_kb_update_ms = Date.now() - t0;

  // -------- Stage 7: mark job completed --------
  const pipelineMs = Date.now() - pipelineStartedAt;

  const extractionTimings: Partial<ExtractionTimings> = extraction.timings ?? {};
  const llm_ms = (extractionTimings.pass1_ms ?? 0) + (extractionTimings.pass2_ms ?? 0);
  const db_ms =
    timings.session_insert_ms +
    timings.chunk_storage_ms +
    timings.label_resolution_ms +
    timings.session_kb_update_ms +
    timings.continuity_ms;

  const fullTimings = {
    ...extractionTimings,
    routing_ms: timings.routing_ms,
    session_insert_ms: timings.session_insert_ms,
    continuity_ms: timings.continuity_ms,
    chunk_storage_ms: timings.chunk_storage_ms,
    label_resolution_ms: timings.label_resolution_ms,
    session_kb_update_ms: timings.session_kb_update_ms,
    extraction_ms: extractionMs,
    pipeline_ms: pipelineMs - extractionMs,
    llm_ms,
    db_ms,
    end_to_end_ms: pipelineMs,
  };

  await setJobFields(job.id, {
    status: "completed",
    knowledge_base_id: targetKbId,
    completed_at: Date.now(),
    chunks_created: result.stored,
    chunks_deduplicated: result.deduplicated,
    chunks_superseded: result.superseded,
    extraction_model: extraction.model,
    extraction_ms: extractionMs,
    pipeline_ms: pipelineMs,
    result_json: JSON.stringify({
      stored: result.stored,
      deduplicated: result.deduplicated,
      superseded: result.superseded,
      passes: extraction.passes,
      session_id: session.id,
      timings: fullTimings,
    }),
  });

  console.log(
    "[benchmark]",
    JSON.stringify({
      job_id: job.id,
      conversation_chars: job.conversationText.length,
      conversation_tokens_approx: Math.round(job.conversationText.length / 4),
      chunks_created: result.stored,
      chunks_deduplicated: result.deduplicated,
      timings: fullTimings,
      model: extraction.model,
    })
  );

  console.log(
    `[job-queue] job=${job.id} completed  stored=${result.stored}  dedup=${result.deduplicated}  superseded=${result.superseded}  extraction_ms=${extractionMs}  pipeline_ms=${pipelineMs}`
  );

  // -------- Stage 8: analytics --------
  track(job.userId, "mcp.save_session.completed", {
    knowledge_base_id: targetKbId,
    tool_used: job.toolUsed,
    extraction_model: extraction.model,
    extraction_ms: extractionMs,
    pipeline_ms: pipelineMs,
    chunks_created: result.stored,
    chunks_deduplicated: result.deduplicated,
    chunks_superseded: result.superseded,
    passes: extraction.passes,
  });

  // -------- Stage 9 (background): session_summary chunk --------
  const extractorEmittedSummaryChunk = extraction.chunks.some(
    (c) => (c.chunk_type as string) === "session_summary"
  );
  if (
    extraction.sessionSummary &&
    extraction.sessionSummary.trim().length > 100 &&
    !extractorEmittedSummaryChunk
  ) {
    void (async () => {
      try {
        await storeChunksRaw(
          targetKbId,
          [
            {
              content: datePrefix + extraction.sessionSummary,
              chunk_type: "session_summary",
              topic_tags: ["session-summary", "overview"],
              source_type: "session",
            },
          ],
          job.userId,
          session.id,
          sessionDate
        );
      } catch (err: any) {
        console.error("[server-extraction:summary-background] failed:", err?.message ?? String(err));
      }
    })();
  }

  // -------- Stage 10 (background): entity coverage verification --------
  if (extraction.sessionSummary && extraction.sessionSummary.trim().length > 0) {
    void (async () => {
      try {
        const summaryEntities = extractEntities(extraction.sessionSummary);
        const gaps = checkCoverage(
          summaryEntities,
          allInputChunks.map((c) => ({ content: c.content }))
        );
        if (gaps.length === 0) return;

        const supplementary = generateSupplementaryChunks(gaps, datePrefix);
        if (supplementary.length === 0) return;

        const rawResult = await storeChunksRaw(
          targetKbId,
          supplementary.map((s) => ({
            content: s.content,
            chunk_type: s.chunk_type,
            topic_tags: s.topic_tags,
            source_type: "coverage_verification",
          })),
          job.userId,
          session.id,
          sessionDate
        );

        if (rawResult.stored > 0) {
          await sessionRepo.updateSessionCounts(redis, session.id, {
            chunks_added: result.stored + rawResult.stored,
          });
        }
        console.log(
          `[server-extraction:coverage-background] ${gaps.length} gap(s) → ${rawResult.stored} supplementary chunks (job=${job.id})`
        );
      } catch (err: any) {
        console.error("[server-extraction:coverage-background] failed:", err?.message ?? String(err));
      }
    })();
  }

  // -------- Stage 11 (background): regenerate KB description + embedding --------
  void (async () => {
    try {
      await updateKbDescription(targetKbId);
    } catch (err: any) {
      console.error("[routing:description-update-background] failed:", err?.message ?? String(err));
    }
  })();
}
