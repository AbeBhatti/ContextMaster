import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { Chunk } from "../../lib/types";
import { avatarColor, formatRelativeTime, initialOf } from "../../lib/constants";
import { api } from "../../lib/api";
import { ChunkEditor } from "./ChunkEditor";
import { track } from "../../lib/analytics";

interface ChunkCardProps {
  chunk: Chunk;
  accentColor: string;
  readOnly?: boolean;
  // Other chunks in the same KB that this one points at via
  // related_chunk_ids. Resolved by the parent so we don't have to refetch.
  relatedChunks?: Chunk[];
  onUpdated: (chunk: Chunk) => void;
  onDeleted: (id: string) => void;
}

function chunkPreview(content: string): string {
  const trimmed = content.trim().replace(/^[A-Z][a-zA-Z ]+:\s*/, "");
  const words = trimmed.split(/\s+/).slice(0, 8).join(" ");
  return words.length < trimmed.length ? `${words}…` : words;
}

export function ChunkCard({
  chunk,
  accentColor,
  readOnly = false,
  relatedChunks,
  onUpdated,
  onDeleted,
}: ChunkCardProps) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const performDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await api.knowledgeBases.deleteChunk(chunk.knowledge_base_id, chunk.id);
      track("chunk.deleted", { kb_id: chunk.knowledge_base_id });
      onDeleted(chunk.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  };

  if (editing) {
    return (
      <ChunkEditor
        chunk={chunk}
        onSaved={(updated) => {
          onUpdated(updated);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const authorName = chunk.created_by.name ?? "?";
  const authorInitial = initialOf(authorName);

  return (
    <div
      id={`chunk-${chunk.id}`}
      className="group relative rounded-[9px] border bg-white p-3.5"
      style={{ borderColor: "rgba(67,55,39,0.10)" }}
    >
      <div className="mb-2 text-[13px] leading-relaxed text-ink-900">
        {chunk.content}
      </div>
      {relatedChunks && relatedChunks.length > 0 && (
        <div className="mb-2 text-[11.5px] text-ink-500">
          <span className="text-ink-400">Related to: </span>
          {relatedChunks.map((rc, i) => (
            <span key={rc.id}>
              {i > 0 && <span className="text-ink-300">, </span>}
              <a
                href={`#chunk-${rc.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  document
                    .getElementById(`chunk-${rc.id}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
                className="text-ink-600 underline decoration-dotted underline-offset-2 hover:text-ink-800"
              >
                {chunkPreview(rc.content)}
              </a>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {chunk.topic_tags.map((t) => (
          <span
            key={t}
            className="rounded-full bg-cream-300 px-2 py-0.5 text-[10.5px] text-ink-600"
          >
            #{t}
          </span>
        ))}
        <span className="flex-1" />
        <span
          className="flex h-[18px] w-[18px] items-center justify-center rounded-full text-[9.5px] font-bold text-white"
          style={{ background: avatarColor(chunk.created_by.id ?? authorName) }}
          title={authorName}
        >
          {authorInitial}
        </span>
        <span className="text-[11px] text-ink-500">
          {formatRelativeTime(chunk.updated_at ?? chunk.created_at)}
        </span>
      </div>
      {error && (
        <div className="mt-2 text-[11.5px] text-[#b04545]">{error}</div>
      )}
      {confirmDelete ? (
        <div className="mt-2 flex justify-end gap-2 border-t pt-2"
          style={{ borderColor: "rgba(67,55,39,0.10)" }}
        >
          <span className="mr-auto text-[12px] text-ink-700">Archive this chunk?</span>
          <button
            disabled={deleting}
            onClick={() => setConfirmDelete(false)}
            className="rounded-md border px-2 py-0.5 text-[11.5px] text-ink-700"
            style={{ borderColor: "rgba(67,55,39,0.18)" }}
          >
            Cancel
          </button>
          <button
            disabled={deleting}
            onClick={performDelete}
            className="rounded-md bg-[#b04545] px-2 py-0.5 text-[11.5px] font-medium text-white disabled:opacity-60"
          >
            {deleting ? "Archiving…" : "Archive"}
          </button>
        </div>
      ) : (
        !readOnly && (
          <div
            className="absolute right-2 top-2 flex gap-0.5 rounded-md bg-cream-50 p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
            style={{ border: `0.5px solid ${accentColor}33` }}
          >
            <button
              onClick={() => setEditing(true)}
              className="flex h-6 w-6 items-center justify-center rounded text-ink-600 hover:bg-cream-200"
              title="Edit"
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex h-6 w-6 items-center justify-center rounded text-ink-600 hover:bg-cream-200"
              title="Archive"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )
      )}
    </div>
  );
}
