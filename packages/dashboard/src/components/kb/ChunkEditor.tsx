import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../../lib/api";
import type { Chunk } from "../../lib/types";
import { CHUNK_TYPE_OPTIONS } from "../../lib/constants";
import { track } from "../../lib/analytics";

interface ChunkEditorProps {
  chunk: Chunk;
  onSaved: (updated: Chunk) => void;
  onCancel: () => void;
}

export function ChunkEditor({ chunk, onSaved, onCancel }: ChunkEditorProps) {
  const [content, setContent] = useState(chunk.content);
  const [chunkType, setChunkType] = useState(chunk.chunk_type);
  const [tagsText, setTagsText] = useState(chunk.topic_tags.join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    content !== chunk.content ||
    chunkType !== chunk.chunk_type ||
    tagsText !==
      chunk.topic_tags.join(", ");

  const onSave = async () => {
    if (!content.trim() || saving) return;
    setSaving(true);
    setError(null);
    const tags = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      const updated = await api.knowledgeBases.updateChunk(
        chunk.knowledge_base_id,
        chunk.id,
        {
          content: content.trim(),
          chunk_type: chunkType,
          topic_tags: tags,
        }
      );
      track("chunk.edited", {
        kb_id: chunk.knowledge_base_id,
        chunk_type: chunkType,
      });
      onSaved({ ...chunk, ...updated, topic_tags: tags, content: content.trim(), chunk_type: chunkType });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-[9px] border bg-white p-3"
      style={{ borderColor: "rgba(67,55,39,0.10)" }}
    >
      <textarea
        autoFocus
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={4}
        className="resize-vertical rounded-md border bg-cream-50 p-2 text-[13px] leading-relaxed text-ink-900 outline-none"
        style={{ borderColor: "rgba(67,55,39,0.12)" }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={chunkType}
          onChange={(e) => setChunkType(e.target.value)}
          className="rounded-md border bg-cream-50 px-2 py-1 text-[12px] text-ink-800 outline-none"
          style={{ borderColor: "rgba(67,55,39,0.12)" }}
        >
          {CHUNK_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {!CHUNK_TYPE_OPTIONS.some((o) => o.value === chunkType) && (
            <option value={chunkType}>{chunkType}</option>
          )}
        </select>
        <input
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder="tag1, tag2"
          className="flex-1 rounded-md border bg-cream-50 px-2 py-1 text-[12px] text-ink-800 outline-none placeholder:text-ink-500"
          style={{ borderColor: "rgba(67,55,39,0.12)" }}
        />
      </div>
      {error && <div className="text-[11.5px] text-[#b04545]">{error}</div>}
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md border px-2.5 py-1 text-[12px] text-ink-700"
          style={{ borderColor: "rgba(67,55,39,0.18)" }}
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={!dirty || !content.trim() || saving}
          className="flex items-center gap-1.5 rounded-md bg-ink-800 px-2.5 py-1 text-[12px] font-medium text-cream-50 disabled:opacity-50"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          Save
        </button>
      </div>
    </div>
  );
}
