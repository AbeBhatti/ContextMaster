import { getRedis } from "../lib/redis.js";
import { generateEmbeddings } from "./embeddingService.js";
import * as chunkRepo from "../lib/chunkRepo.js";
import * as kbRepo from "../lib/kbRepo.js";
import * as docRepo from "../lib/docRepo.js";
import type { ChunkRow } from "../lib/chunkRepo.js";

// Redis port of the reference's documentService.ts. The parse + ~250-word
// chunking + batched embedding logic is byte-for-byte identical; only the
// persistence layer changed: chunks are written via chunkRepo (source_type=
// document, chunk_type=reference, source_document_id set) and document/KB
// counters update through docRepo/kbRepo instead of Supabase tables.

// pdf-parse and mammoth are CommonJS — dynamic import to play nice with ESM.
async function parsePdf(buffer: Buffer): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buffer);
  return data.text;
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

function parseTxt(buffer: Buffer): string {
  return buffer.toString("utf-8");
}

function parseCsv(buffer: Buffer): string {
  const text = buffer.toString("utf-8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return "";
  const headers = lines[0].split(",");
  return lines
    .slice(1)
    .map((line) => {
      const fields = line.split(",");
      return headers.map((h, i) => `${h.trim()}: ${(fields[i] ?? "").trim()}`).join(", ");
    })
    .join("\n");
}

/**
 * Split text into ~250-word chunks on paragraph boundaries with ~35-word
 * overlap. Verbatim from the reference.
 */
function chunkText(text: string): string[] {
  const TARGET_WORDS = 250;
  const OVERLAP_WORDS = 35;

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: string[] = [];
  let buffer: string[] = [];
  let bufferWords = 0;

  const flush = () => {
    if (bufferWords > 0) {
      chunks.push(buffer.join("\n\n"));
      const tail = buffer.join(" ").split(/\s+/).slice(-OVERLAP_WORDS);
      buffer = tail.length > 0 ? [tail.join(" ")] : [];
      bufferWords = tail.length;
    }
  };

  for (const para of paragraphs) {
    const words = para.split(/\s+/);
    if (words.length > TARGET_WORDS * 1.5) {
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        const sw = sentence.split(/\s+/).length;
        if (bufferWords + sw > TARGET_WORDS) flush();
        buffer.push(sentence);
        bufferWords += sw;
      }
    } else {
      if (bufferWords + words.length > TARGET_WORDS && bufferWords > 0) flush();
      buffer.push(para);
      bufferWords += words.length;
    }
  }

  if (bufferWords > 0) chunks.push(buffer.join("\n\n"));
  return chunks.filter((c) => c.trim().length > 20);
}

/**
 * Process an uploaded document: parse → chunk → embed → store as
 * source_type=document knowledge chunks, then update the document + KB
 * counters. On failure, marks the document `failed` with the error and rethrows.
 */
export async function processDocument(
  documentId: string,
  buffer: Buffer,
  fileType: string,
  userId: string
): Promise<void> {
  const redis = getRedis();
  try {
    let text: string;
    switch (fileType) {
      case "pdf":
        text = await parsePdf(buffer);
        break;
      case "docx":
        text = await parseDocx(buffer);
        break;
      case "txt":
      case "md":
        text = parseTxt(buffer);
        break;
      case "csv":
        text = parseCsv(buffer);
        break;
      default:
        throw new Error(`Unsupported file type: ${fileType}`);
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      throw new Error("Document produced no extractable text");
    }

    const doc = await docRepo.getDocument(redis, documentId);
    if (!doc) throw new Error("Document record disappeared during processing");
    const knowledgeBaseId = doc.knowledge_base_id;

    // Embed in batches of up to 100, inserting as we go.
    const BATCH_SIZE = 100;
    const now = new Date().toISOString();
    let inserted = 0;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const embeddings = await generateEmbeddings(batch);
      const items = batch.map((content, idx) => ({
        row: {
          knowledge_base_id: knowledgeBaseId,
          content,
          chunk_type: "reference",
          topic_tags: [],
          related_chunk_ids: [],
          source_type: "document",
          status: "active",
          created_by: userId,
          session_id: null,
          topic_key: null,
          valid_from: now,
          source_document_id: documentId,
        } as ChunkRow,
        embedding: embeddings[idx],
      }));
      const stored = await chunkRepo.insertChunks(redis, items);
      inserted += stored.length;
    }

    await docRepo.updateDocument(redis, documentId, {
      processing_status: "ready",
      chunk_count: inserted,
    });

    const count = await chunkRepo.countActive(redis, [knowledgeBaseId]);
    await kbRepo.setChunkCount(redis, knowledgeBaseId, count);
  } catch (err: any) {
    await docRepo.updateDocument(redis, documentId, {
      processing_status: "failed",
      processing_error: err?.message ?? String(err),
    });
    throw err;
  }
}
