import { randomUUID } from "node:crypto";
import type { RedisClient } from "./redis.js";
import { idx, kbPrefix, k } from "./keys.js";
import { floatBuf, tagIn } from "./search.js";
import type { KnowledgeBase } from "./types.js";

// Redis data layer for knowledge_bases. Phase 3 needs create/get/names/count/
// delete to exercise the engine; workspace wiring + listing land in phase 6.

function msToIso(ms: string | null | undefined): string {
  const n = Number(ms);
  return Number.isNaN(n) ? new Date().toISOString() : new Date(n).toISOString();
}

function hashToKb(id: string, h: Record<string, string>): KnowledgeBase {
  return {
    id,
    workspace_id: h.workspace_id ?? "",
    name: h.name ?? "",
    description: h.description ?? null,
    auto_description: h.auto_description ?? null,
    description_embedding: null, // stored as a binary field; not rehydrated here
    kb_type: h.kb_type ?? "general",
    summary: h.summary ?? null,
    last_session_summary: h.last_session_summary ?? null,
    chunk_count: Number(h.chunk_count ?? 0),
    is_shared: h.is_shared === "1" || h.is_shared === "true",
    created_at: msToIso(h.created_at),
    updated_at: msToIso(h.updated_at),
  };
}

export interface CreateKbInput {
  workspace_id: string;
  name: string;
  description?: string | null;
  kb_type?: string;
  is_shared?: boolean;
}

export async function createKb(redis: RedisClient, input: CreateKbInput): Promise<KnowledgeBase> {
  const id = randomUUID();
  const now = Date.now();
  const fields: string[] = [
    "workspace_id", input.workspace_id,
    "name", input.name,
    "kb_type", input.kb_type ?? "general",
    "chunk_count", "0",
    "is_shared", input.is_shared ? "1" : "0",
    "created_at", String(now),
    "updated_at", String(now),
  ];
  if (input.description) fields.push("description", input.description);

  await redis.sendCommand(["HSET", k.kb(id), ...fields]);
  await redis.sAdd(k.workspaceKbs(input.workspace_id), id);
  return hashToKb(id, Object.fromEntries(chunkPairs(fields)));
}

function chunkPairs(flat: string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < flat.length; i += 2) pairs.push([flat[i], flat[i + 1]]);
  return pairs;
}

export async function getKb(redis: RedisClient, id: string): Promise<KnowledgeBase | null> {
  const h = (await redis.hGetAll(k.kb(id))) as Record<string, string>;
  if (!h || Object.keys(h).length === 0) return null;
  return hashToKb(id, h);
}

export async function getKbNames(redis: RedisClient, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const names = await Promise.all(ids.map((id) => redis.hGet(k.kb(id), "name")));
  ids.forEach((id, i) => map.set(id, (names[i] as string) ?? "Unknown"));
  return map;
}

export async function setChunkCount(redis: RedisClient, id: string, count: number): Promise<void> {
  await redis.sendCommand(["HSET", k.kb(id), "chunk_count", String(count), "updated_at", String(Date.now())]);
}

export async function setDescriptionEmbedding(
  redis: RedisClient,
  id: string,
  embedding: number[]
): Promise<void> {
  await redis.sendCommand(["HSET", k.kb(id), "description_embedding", floatBuf(embedding)]);
}

// Whether a KB already carries a description_embedding vector (drives the
// routing backfill, replacing `WHERE description_embedding IS NULL`).
export async function hasDescriptionEmbedding(redis: RedisClient, id: string): Promise<boolean> {
  const exists = (await redis.sendCommand(["HEXISTS", k.kb(id), "description_embedding"])) as number;
  return exists === 1;
}

export async function deleteKb(redis: RedisClient, id: string, workspaceId?: string): Promise<void> {
  await redis.del(k.kb(id));
  if (workspaceId) await redis.sRem(k.workspaceKbs(workspaceId), id);
}

// All KBs in a workspace (resolves the workspaceKbs Set → hydrated rows).
export async function getKbsByWorkspace(
  redis: RedisClient,
  workspaceId: string
): Promise<KnowledgeBase[]> {
  const ids = (await redis.sMembers(k.workspaceKbs(workspaceId))) as string[];
  const out: KnowledgeBase[] = [];
  for (const id of ids) {
    const kb = await getKb(redis, id);
    if (kb) out.push(kb);
  }
  return out;
}

// KBs across every workspace id supplied (used by check_memory / list).
export async function getKbsByWorkspaces(
  redis: RedisClient,
  workspaceIds: string[]
): Promise<KnowledgeBase[]> {
  const out: KnowledgeBase[] = [];
  for (const wsId of workspaceIds) {
    out.push(...(await getKbsByWorkspace(redis, wsId)));
  }
  return out;
}

export interface UpdateKbFields {
  name?: string;
  description?: string;
  auto_description?: string;
  last_session_summary?: string;
  summary?: string;
  kb_type?: string;
}

export async function updateKb(
  redis: RedisClient,
  id: string,
  fields: UpdateKbFields
): Promise<KnowledgeBase | null> {
  const args: string[] = [];
  if (fields.name != null) args.push("name", fields.name);
  if (fields.description != null) args.push("description", fields.description);
  if (fields.auto_description != null) args.push("auto_description", fields.auto_description);
  if (fields.last_session_summary != null)
    args.push("last_session_summary", fields.last_session_summary);
  if (fields.summary != null) args.push("summary", fields.summary);
  if (fields.kb_type != null) args.push("kb_type", fields.kb_type);
  args.push("updated_at", String(Date.now()));
  await redis.sendCommand(["HSET", k.kb(id), ...args]);
  return getKb(redis, id);
}

// Move a KB to another workspace: rewrite workspace_id + swap the workspaceKbs
// Set membership. All chunks stay intact (chunk rows carry only the KB id).
export async function moveKb(
  redis: RedisClient,
  id: string,
  fromWorkspaceId: string,
  toWorkspaceId: string
): Promise<KnowledgeBase | null> {
  await redis.sendCommand([
    "HSET", k.kb(id), "workspace_id", toWorkspaceId, "updated_at", String(Date.now()),
  ]);
  await redis.sRem(k.workspaceKbs(fromWorkspaceId), id);
  await redis.sAdd(k.workspaceKbs(toWorkspaceId), id);
  return getKb(redis, id);
}

// ============================================================
// KB vector match — Redis analogue of the match_knowledge_bases RPC.
//
// idx:kbs only indexes hashes that carry a description_embedding vector field
// (hashes without it never enter the HNSW index), which mirrors the
// reference's `WHERE description_embedding IS NOT NULL`. Filtered to the
// caller's accessible workspace ids, then ranked by cosine similarity.
// ============================================================

export interface KbMatch {
  kb_id: string;
  kb_name: string;
  kb_description: string | null;
  kb_auto_description: string | null;
  workspace_id: string;
  chunk_count: number;
  similarity: number;
}

function bufToStr(x: unknown): string {
  return Buffer.isBuffer(x) ? x.toString("utf8") : String(x ?? "");
}

// FT.SEARCH reply with RETURN fields: [count, key, [f,v,...], key, [...], ...]
function parseKbSearch(reply: unknown): Array<{ id: string; fields: Record<string, string> }> {
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
    out.push({ id: key.startsWith(kbPrefix) ? key.slice(kbPrefix.length) : key, fields });
  }
  return out;
}

export async function matchKnowledgeBases(
  redis: RedisClient,
  queryEmbedding: number[],
  workspaceIds: string[],
  matchThreshold: number,
  matchCount: number
): Promise<KbMatch[]> {
  if (workspaceIds.length === 0) return [];
  const filter = tagIn("workspace_id", workspaceIds);
  const query = `(${filter})=>[KNN ${matchCount} @description_embedding $BLOB AS kb_score]`;
  let reply: unknown;
  try {
    reply = await redis.sendCommand([
      "FT.SEARCH", idx.kbs, query,
      "PARAMS", "2", "BLOB", floatBuf(queryEmbedding),
      "SORTBY", "kb_score", "ASC",
      "LIMIT", "0", String(matchCount),
      "RETURN", "6", "name", "description", "auto_description", "workspace_id", "chunk_count", "kb_score",
      "DIALECT", "2",
    ]);
  } catch {
    // No KBs with description_embedding yet → empty vector space.
    return [];
  }
  return parseKbSearch(reply)
    .map((r) => ({
      kb_id: r.id,
      kb_name: r.fields.name ?? "",
      kb_description: r.fields.description ?? null,
      kb_auto_description: r.fields.auto_description ?? null,
      workspace_id: r.fields.workspace_id ?? "",
      chunk_count: Number(r.fields.chunk_count ?? 0),
      // COSINE distance → cosine similarity, exactly 1 - (a <=> b).
      similarity: 1 - Number(r.fields.kb_score ?? 1),
    }))
    .filter((m) => m.similarity >= matchThreshold);
}
