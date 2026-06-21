import { useState } from "react";
import { FileText, Loader2, Trash2 } from "lucide-react";
import type { DocumentRecord } from "../../lib/types";
import { formatBytes, formatRelativeTime } from "../../lib/constants";
import { api } from "../../lib/api";

interface DocumentListProps {
  documents: DocumentRecord[];
  onDeleted: (id: string) => void;
  showKb?: boolean;
  isViewer?: boolean;
}

export function DocumentList({
  documents,
  onDeleted,
  showKb = false,
  isViewer = false,
}: DocumentListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      await api.documents.delete(id);
      onDeleted(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  };

  if (documents.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-[13px] text-ink-400">
        No documents uploaded yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {error && (
        <div className="text-[12px] text-[#b04545]">{error}</div>
      )}
      {documents.map((d) => (
        <div
          key={d.id}
          className="flex items-center gap-3 rounded-[9px] border bg-white p-3"
          style={{ borderColor: "rgba(67,55,39,0.10)" }}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-cream-300 text-ink-600">
            <FileText size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-ink-900">
              {d.file_name}
            </div>
            <div className="mt-0.5 text-[11.5px] text-ink-500">
              {formatBytes(d.file_size)} · {d.chunk_count} chunks
              {showKb && d.knowledge_base_name
                ? ` · ${d.knowledge_base_name}`
                : ""}
              {" · uploaded "}
              {formatRelativeTime(d.created_at)}
            </div>
            {d.processing_error && (
              <div className="mt-1 text-[11.5px] text-[#b04545]">
                {d.processing_error}
              </div>
            )}
          </div>
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={statusStyle(d.processing_status)}
          >
            {prettyStatus(d.processing_status)}
          </span>
          {!isViewer && (
            <button
              onClick={() => remove(d.id)}
              disabled={deletingId === d.id}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 hover:bg-cream-200 disabled:opacity-60"
              title="Delete document"
            >
              {deletingId === d.id ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Trash2 size={12} />
              )}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function statusStyle(status: string): React.CSSProperties {
  switch (status) {
    case "ready":
    case "completed":
      return { background: "rgba(95,165,122,.15)", color: "#2f6b48" };
    case "processing":
    case "pending":
      return { background: "rgba(214,162,74,.15)", color: "#8a5e1f" };
    case "error":
    case "failed":
      return { background: "rgba(176,69,69,.12)", color: "#b04545" };
    default:
      return { background: "rgba(138,132,115,.15)", color: "#56523f" };
  }
}

function prettyStatus(status: string): string {
  if (!status) return "—";
  return status.charAt(0).toUpperCase() + status.slice(1);
}
