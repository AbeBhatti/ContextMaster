import { randomBytes } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import type { RedisClient } from "./redis.js";
import { k } from "./keys.js";
import type { Document } from "./types.js";

// Redis data layer for documents. Replaces the reference's `kb_documents`
// table AND Supabase Storage: metadata lives in a Hash, the file bytes are
// written to local disk under STORAGE_DIR (path kept in Redis). kbDocs is a
// per-KB Set of document ids for listing.

const STORAGE_DIR = process.env.STORAGE_DIR || "./storage";

function storageRoot(): string {
  return resolve(process.cwd(), STORAGE_DIR);
}

function msToIso(ms: string | null | undefined): string {
  const n = Number(ms);
  return Number.isNaN(n) ? new Date().toISOString() : new Date(n).toISOString();
}

function hashToDocument(id: string, h: Record<string, string>): Document {
  return {
    id,
    knowledge_base_id: h.knowledge_base_id ?? "",
    file_name: h.file_name ?? "",
    file_type: h.file_type ?? "",
    file_size: Number(h.file_size ?? 0),
    storage_path: h.storage_path ?? "",
    processing_status: h.processing_status ?? "processing",
    processing_error: h.processing_error || null,
    chunk_count: Number(h.chunk_count ?? 0),
    uploaded_by: h.uploaded_by ?? "",
    created_at: msToIso(h.created_at),
    updated_at: msToIso(h.updated_at),
  };
}

// Write file bytes to disk and return the relative storage path stored in
// Redis. Mirrors the reference's `documents/{ws}/{docId}/{name}` layout.
export async function writeDocumentBytes(
  workspaceId: string,
  documentId: string,
  fileName: string,
  buffer: Buffer
): Promise<string> {
  const relPath = join("documents", workspaceId, documentId, fileName);
  const absPath = join(storageRoot(), relPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, buffer);
  return relPath;
}

export async function deleteDocumentBytes(storagePath: string): Promise<void> {
  if (!storagePath) return;
  const absDir = dirname(join(storageRoot(), storagePath));
  try {
    await rm(absDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup — a missing file must not block the delete.
  }
}

export function newDocumentId(): string {
  return randomBytes(16).toString("hex");
}

export async function createDocument(
  redis: RedisClient,
  input: {
    id: string;
    knowledge_base_id: string;
    file_name: string;
    file_type: string;
    file_size: number;
    storage_path: string;
    uploaded_by: string;
    processing_status?: string;
  }
): Promise<Document> {
  const now = Date.now();
  await redis.sendCommand([
    "HSET", k.doc(input.id),
    "knowledge_base_id", input.knowledge_base_id,
    "file_name", input.file_name,
    "file_type", input.file_type,
    "file_size", String(input.file_size),
    "storage_path", input.storage_path,
    "processing_status", input.processing_status ?? "processing",
    "chunk_count", "0",
    "uploaded_by", input.uploaded_by,
    "created_at", String(now),
    "updated_at", String(now),
  ]);
  await redis.sAdd(k.kbDocs(input.knowledge_base_id), input.id);
  return (await getDocument(redis, input.id))!;
}

export async function getDocument(redis: RedisClient, id: string): Promise<Document | null> {
  const h = (await redis.hGetAll(k.doc(id))) as Record<string, string>;
  if (!h || Object.keys(h).length === 0) return null;
  return hashToDocument(id, h);
}

export async function updateDocument(
  redis: RedisClient,
  id: string,
  fields: { processing_status?: string; processing_error?: string | null; chunk_count?: number }
): Promise<void> {
  const args: string[] = [];
  if (fields.processing_status != null) args.push("processing_status", fields.processing_status);
  if (fields.processing_error != null) args.push("processing_error", fields.processing_error);
  if (fields.chunk_count != null) args.push("chunk_count", String(fields.chunk_count));
  args.push("updated_at", String(Date.now()));
  await redis.sendCommand(["HSET", k.doc(id), ...args]);
}

export async function listDocumentsByKb(redis: RedisClient, kbId: string): Promise<Document[]> {
  const ids = (await redis.sMembers(k.kbDocs(kbId))) as string[];
  const out: Document[] = [];
  for (const id of ids) {
    const doc = await getDocument(redis, id);
    if (doc) out.push(doc);
  }
  out.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return out;
}

export async function deleteDocument(redis: RedisClient, doc: Document): Promise<void> {
  await redis.del(k.doc(doc.id));
  await redis.sRem(k.kbDocs(doc.knowledge_base_id), doc.id);
  await deleteDocumentBytes(doc.storage_path);
}
