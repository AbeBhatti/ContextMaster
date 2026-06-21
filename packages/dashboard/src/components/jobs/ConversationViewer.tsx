import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import { api } from "../../lib/api";
import { ApiError } from "../../lib/api";
import { formatRelativeTime, toolMeta } from "../../lib/constants";
import type { ProcessingJob } from "../../lib/types";

interface ConversationViewerProps {
  jobId: string;
  onClose: () => void;
  // Called after a successful re-extract so the caller can refetch the list
  // and surface the new queued job at the top of the timeline.
  onReExtracted?: (newJobId: string) => void;
}

interface Turn {
  speaker: "user" | "ai" | "system";
  text: string;
}

// Parse a normalised transcript into User/AI turns. The server's
// normalizeConversation collapses every tool's turn marker to "User:" / "AI:",
// so a robust split on those tokens recovers the original shape. Falls back
// to a single "system" block for content that doesn't match either marker.
function parseConversation(text: string): Turn[] {
  if (!text) return [];
  const turns: Turn[] = [];
  // Split on a line that begins with "User:" or "AI:" — keep the marker so we
  // know which speaker each chunk belongs to.
  const parts = text.split(/(^|\n)(User:|AI:)\s?/);
  // .split returns an interleaved array of [pre, separator, marker, body, separator, marker, body, ...].
  // The first element is whatever preceded the first marker (often empty).
  if (parts[0] && parts[0].trim().length > 0) {
    turns.push({ speaker: "system", text: parts[0].trim() });
  }
  for (let i = 1; i < parts.length; i += 3) {
    const marker = parts[i + 1];
    const body = parts[i + 2] ?? "";
    if (!marker) continue;
    turns.push({
      speaker: marker === "User:" ? "user" : "ai",
      text: body.trim(),
    });
  }
  return turns.length > 0
    ? turns
    : [{ speaker: "system", text }];
}

function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatusPill({ status }: { status: ProcessingJob["status"] }) {
  const meta = {
    queued: { label: "Queued", color: "#6b7280", bg: "rgba(107,114,128,0.14)" },
    processing: {
      label: "Processing",
      color: "#3d5a80",
      bg: "rgba(61,90,128,0.14)",
    },
    completed: {
      label: "Completed",
      color: "#3f7a4b",
      bg: "rgba(99,160,116,0.14)",
    },
    failed: {
      label: "Failed",
      color: "#dc2626",
      bg: "rgba(220,38,38,0.12)",
    },
  }[status];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: meta.bg, color: meta.color }}
    >
      {status === "queued" || status === "processing" ? (
        <span
          className="inline-block h-1.5 w-1.5 animate-pulse rounded-full"
          style={{ background: meta.color }}
        />
      ) : null}
      {meta.label}
    </span>
  );
}

export function ConversationViewer({
  jobId,
  onClose,
  onReExtracted,
}: ConversationViewerProps) {
  const [job, setJob] = useState<ProcessingJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reExtractBusy, setReExtractBusy] = useState(false);
  const [reExtractError, setReExtractError] = useState<string | null>(null);

  // Fetch the job detail. Aborts on unmount so a slow request from a closed
  // panel doesn't update state for a panel that's gone.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api.jobs
      .get(jobId, controller.signal)
      .then((j) => setJob(j))
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return;
        setError(
          e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e)
        );
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [jobId]);

  // Esc closes the panel.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const turns = useMemo(
    () => (job?.conversation_text ? parseConversation(job.conversation_text) : []),
    [job?.conversation_text]
  );

  const handleReExtract = async () => {
    if (!job) return;
    setReExtractBusy(true);
    setReExtractError(null);
    try {
      const res = await api.jobs.reExtract(job.id);
      onReExtracted?.(res.job_id);
      onClose();
    } catch (e: unknown) {
      setReExtractError(
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e)
      );
      setReExtractBusy(false);
    }
  };

  const tool = toolMeta(job?.tool_used ?? null);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: "rgba(24,24,27,.32)", backdropFilter: "blur(2px)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-[820px] flex-col bg-cream-50 shadow-2xl"
        style={{ borderLeft: "0.5px solid rgba(24,24,27,0.15)" }}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div
          className="flex items-start justify-between gap-4 px-6 pb-4 pt-5"
          style={{ borderBottom: "0.5px solid rgba(24,24,27,0.10)" }}
        >
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-400">
              Server-side extraction
            </div>
            <h2 className="m-0 mt-0.5 text-[18px] font-semibold tracking-tight text-ink-900">
              Conversation
              {job?.knowledge_base_name && (
                <span className="ml-2 text-[14px] font-medium text-ink-500">
                  · {job.knowledge_base_name}
                </span>
              )}
            </h2>
            {job && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-600">
                <StatusPill status={job.status} />
                {job.tool_used && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium text-cream-50"
                    style={{ background: tool.tint }}
                  >
                    <span className="text-[10px]">{tool.icon}</span>
                    {tool.label}
                  </span>
                )}
                <span className="text-ink-300">·</span>
                <span className="text-ink-500">
                  {formatRelativeTime(job.created_at)}
                </span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 hover:bg-cream-200"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Transcript */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {loading ? (
              <div className="flex items-center gap-2 text-[13px] text-ink-500">
                <Loader2 size={14} className="animate-spin" />
                Loading conversation…
              </div>
            ) : error ? (
              <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">
                {error}
              </div>
            ) : !job?.conversation_text ? (
              <div className="text-[13px] text-ink-500">
                No conversation text stored for this job.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {turns.map((t, i) => (
                  <div
                    key={i}
                    className="rounded-lg px-3 py-2.5"
                    style={{
                      background:
                        t.speaker === "user"
                          ? "rgba(61,90,128,0.10)"
                          : t.speaker === "ai"
                          ? "rgba(74,138,180,0.08)"
                          : "rgba(24,24,27,0.04)",
                      border: "0.5px solid rgba(24,24,27,0.08)",
                    }}
                  >
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                      {t.speaker === "user"
                        ? "User"
                        : t.speaker === "ai"
                        ? "AI"
                        : "Context"}
                    </div>
                    <pre className="m-0 mt-1 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-900">
                      {t.text}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <aside
            className="w-72 shrink-0 overflow-y-auto px-5 py-5 text-[12px] text-ink-700"
            style={{
              borderLeft: "0.5px solid rgba(24,24,27,0.10)",
              background: "rgba(24,24,27,0.025)",
            }}
          >
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Extraction
            </div>
            <dl className="mt-2 space-y-1.5">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Model</dt>
                <dd className="text-right text-ink-900">
                  {job?.extraction_model ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Extract</dt>
                <dd className="text-right text-ink-900">
                  {formatMs(job?.extraction_ms ?? null)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Pipeline</dt>
                <dd className="text-right text-ink-900">
                  {formatMs(job?.pipeline_ms ?? null)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Passes</dt>
                <dd className="text-right text-ink-900">
                  {job?.result_json?.passes ?? "—"}
                </dd>
              </div>
            </dl>

            <div className="mt-5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Chunks
            </div>
            <dl className="mt-2 space-y-1.5">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Created</dt>
                <dd className="text-right text-ink-900">
                  {job?.chunks_created ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Deduplicated</dt>
                <dd className="text-right text-ink-900">
                  {job?.chunks_deduplicated ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Superseded</dt>
                <dd className="text-right text-ink-900">
                  {job?.chunks_superseded ?? "—"}
                </dd>
              </div>
            </dl>

            {job?.error_message && (
              <>
                <div className="mt-5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-danger">
                  Error
                </div>
                <div className="mt-1 rounded-md bg-danger/10 px-2 py-1.5 text-[12px] leading-snug text-danger">
                  {job.error_message}
                </div>
              </>
            )}

            {reExtractError && (
              <div className="mt-4 rounded-md bg-danger/10 px-2 py-1.5 text-[12px] text-danger">
                {reExtractError}
              </div>
            )}

            {job?.status === "completed" && job.conversation_text && (
              <button
                type="button"
                onClick={handleReExtract}
                disabled={reExtractBusy}
                className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-ink-900 px-3 py-2 text-[12.5px] font-semibold text-cream-50 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {reExtractBusy ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <RefreshCw size={13} />
                )}
                Re-extract with latest prompt
              </button>
            )}

            <p className="mt-3 text-[11px] leading-snug text-ink-500">
              Re-extract runs the same conversation through the current
              extraction prompt. New chunks dedup against existing ones.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
