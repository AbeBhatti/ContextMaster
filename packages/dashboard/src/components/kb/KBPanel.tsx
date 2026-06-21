import { useEffect, useRef, useState } from "react";
import {
  Copy,
  GripHorizontal,
  Loader2,
  MoreHorizontal,
  MoveRight,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { KnowledgeBase } from "../../lib/types";
import { colorsFor, formatRelativeTime } from "../../lib/constants";
import { useDocuments } from "../../hooks/useDocuments";
import { useHistory } from "../../hooks/useHistory";
import { ChunkList } from "./ChunkList";
import { DocumentUpload } from "../documents/DocumentUpload";
import { DocumentList } from "../documents/DocumentList";
import { HistoryTimeline } from "../history/HistoryTimeline";
import { ErrorState } from "../common/ErrorState";
import { ContributorSummary } from "../kb/ContributorSummary";
import { useDashboard } from "../layout/DashboardLayout";
import { api } from "../../lib/api";
import { track } from "../../lib/analytics";

type TabKey = "knowledge" | "documents" | "activity";

interface KBPanelProps {
  workspaceId: string;
  kb: KnowledgeBase;
  allKbs: KnowledgeBase[];
  isViewer?: boolean;
  autoEditName?: boolean;
  onClose: () => void;
  onKbUpdated?: (patch: Partial<KnowledgeBase> & { id: string }) => void;
}

export function KBPanel({
  workspaceId,
  kb,
  allKbs,
  isViewer = false,
  autoEditName = false,
  onClose,
  onKbUpdated,
}: KBPanelProps) {
  const [tab, setTab] = useState<TabKey>("knowledge");
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 10);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    track("kb.viewed", { kb_id: kb.id, kb_type: kb.kb_type });
  }, [kb.id, kb.kb_type]);

  // ESC closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tc = colorsFor(kb.kb_type);
  const isSystem = !!kb.is_system;
  const isReadOnly = isViewer || isSystem;

  // Resizable split between the header (top) and the tabs/content (bottom).
  // Stored in pixels; clamped against the aside height during drag.
  const asideRef = useRef<HTMLElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(280);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      const aside = asideRef.current;
      if (!aside) return;
      const rect = aside.getBoundingClientRect();
      const next = e.clientY - rect.top;
      const min = 80;
      const max = Math.max(min, rect.height - 180);
      setHeaderHeight(Math.max(min, Math.min(max, next)));
    };
    const onUp = () => setIsResizing(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [isResizing]);

  return (
    <>
      <div
        onClick={onClose}
        className="absolute inset-0 transition-opacity"
        style={{
          background: "rgba(58,51,32,.18)",
          backdropFilter: "blur(2px)",
          opacity: mounted ? 1 : 0,
          zIndex: 20,
        }}
      />
      <aside
        ref={asideRef}
        className="absolute bottom-0 right-0 top-0 flex flex-col bg-cream-50 transition-transform"
        style={{
          width: "min(640px, 68%)",
          borderLeft: "0.5px solid rgba(67,55,39,0.15)",
          boxShadow: "-30px 0 60px rgba(58,51,32,.10)",
          transform: mounted ? "translateX(0)" : "translateX(20px)",
          opacity: mounted ? 1 : 0,
          transitionDuration: "220ms",
          zIndex: 21,
        }}
      >
        <header
          className="shrink-0 overflow-y-auto px-7 pb-4 pt-5"
          style={{
            height: headerHeight,
            borderBottom: "0.5px solid rgba(67,55,39,0.10)",
          }}
        >
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize"
                style={{ background: tc.tint, color: tc.text }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: tc.dot }}
                />
                {kb.kb_type}
              </span>
              {kb.is_shared && (
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink-600"
                  style={{ border: "1px dashed rgba(67,55,39,0.3)" }}
                >
                  Shared
                </span>
              )}
              {isSystem && (
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink-600"
                  style={{ border: "1px dashed rgba(67,55,39,0.3)" }}
                  title="Built-in Context Cloud knowledge base — read-only"
                >
                  System
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {!isReadOnly && (
                <KbActionsMenu
                  kb={kb}
                  currentWorkspaceId={workspaceId}
                  onMoved={onClose}
                />
              )}
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 hover:bg-cream-200"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <EditableKbName
            kb={kb}
            disabled={isReadOnly}
            autoEdit={autoEditName && !isReadOnly}
            onSaved={(name) => onKbUpdated?.({ id: kb.id, name })}
          />
          {(kb.summary ?? kb.description) && (
            <p className="m-0 mt-1.5 max-w-[540px] text-sm leading-snug text-ink-600">
              {kb.summary ?? kb.description}
            </p>
          )}
          {kb.last_session_summary && (
            <LastSessionSummary
              kbId={kb.id}
              summary={kb.last_session_summary}
              accent={tc.dot}
            />
          )}
          <div className="mt-3.5 flex items-center gap-4 text-[12px] text-ink-500">
            <span>
              <b className="font-semibold text-ink-800">{kb.chunk_count}</b>{" "}
              {kb.chunk_count === 1 ? "item" : "items"}
            </span>
            <span className="h-[3px] w-[3px] rounded-full bg-cream-500" />
            <span>Updated {formatRelativeTime(kb.updated_at)}</span>
          </div>
          <ContributorSummary workspaceId={workspaceId} kbId={kb.id} />
        </header>

        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize panel"
          onMouseDown={(e) => {
            e.preventDefault();
            setIsResizing(true);
          }}
          onDoubleClick={() => setHeaderHeight(280)}
          className="group relative flex h-2 shrink-0 cursor-row-resize items-center justify-center"
          style={{
            background: isResizing ? "rgba(67,55,39,0.06)" : "transparent",
            transition: "background 120ms",
          }}
          title="Drag to resize · double-click to reset"
        >
          <span
            className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2"
            style={{ background: "rgba(67,55,39,0.10)" }}
          />
          <GripHorizontal
            size={14}
            className={`relative transition-colors ${
              isResizing
                ? "text-ink-700"
                : "text-ink-300 group-hover:text-ink-600"
            }`}
            strokeWidth={2}
          />
        </div>

        <nav
          className="flex shrink-0 gap-1 px-5 pt-2"
          style={{ borderBottom: "0.5px solid rgba(67,55,39,0.10)" }}
        >
          {(
            [
              ["knowledge", "Knowledge"],
              ["documents", "Documents"],
              ["activity", "Activity"],
            ] as [TabKey, string][]
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-3.5 py-2.5 text-[13px] font-medium ${
                tab === k ? "text-ink-900" : "text-ink-500 hover:text-ink-700"
              }`}
              style={{
                borderBottom:
                  tab === k ? "2px solid #3a3320" : "2px solid transparent",
                marginBottom: -1,
              }}
            >
              {l}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto px-7 pb-8 pt-4">
          {tab === "knowledge" && (
            <ChunkList
              workspaceId={workspaceId}
              kbId={kb.id}
              isViewer={isReadOnly}
            />
          )}
          {tab === "documents" && (
            <KbDocumentsTab
              workspaceId={workspaceId}
              kbId={kb.id}
              allKbs={allKbs}
              isViewer={isReadOnly}
            />
          )}
          {tab === "activity" && (
            <KbActivityTab workspaceId={workspaceId} kbId={kb.id} />
          )}
        </div>
      </aside>
    </>
  );
}

function LastSessionSummary({
  kbId,
  summary,
  accent,
}: {
  kbId: string;
  summary: string;
  accent: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const textRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setExpanded(false);
  }, [kbId]);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    setOverflows(el.scrollHeight - el.clientHeight > 1);
  }, [summary, expanded]);

  const collapsedClamp = 4;

  return (
    <div
      className="mt-3.5 rounded-lg p-2.5"
      style={{
        background: "rgba(214,162,74,.08)",
        borderLeft: `2px solid ${accent}`,
      }}
    >
      <div className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-400">
        Last session
      </div>
      <div
        ref={textRef}
        className="text-[13px] leading-snug text-ink-800"
        style={
          expanded
            ? { maxHeight: 160, overflowY: "auto" }
            : {
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: collapsedClamp,
                overflow: "hidden",
              }
        }
      >
        {summary}
      </div>
      {(overflows || expanded) && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-[11.5px] font-medium text-ink-500 hover:text-ink-800"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function EditableKbName({
  kb,
  disabled,
  autoEdit = false,
  onSaved,
}: {
  kb: KnowledgeBase;
  disabled: boolean;
  autoEdit?: boolean;
  onSaved: (name: string) => void;
}) {
  const [editing, setEditing] = useState(autoEdit && !disabled);
  const [draft, setDraft] = useState(kb.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset draft when the active KB changes (panel reopened on a different KB).
  useEffect(() => {
    setDraft(kb.name);
    setEditing(autoEdit && !disabled);
    setError(null);
  }, [kb.id, kb.name, autoEdit, disabled]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = async () => {
    const next = draft.trim();
    if (!next || next === kb.name) {
      setDraft(kb.name);
      setEditing(false);
      setError(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.knowledgeBases.update(kb.id, { name: next });
      onSaved(next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(kb.name);
    setEditing(false);
    setError(null);
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <input
          ref={inputRef}
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          className="m-0 w-full rounded-md bg-cream-100 px-1.5 py-0.5 text-[26px] font-semibold tracking-tight text-ink-900 outline-none ring-2 ring-[rgba(67,55,39,0.25)]"
        />
        {error && (
          <span className="text-[11.5px] text-[#b04545]">{error}</span>
        )}
      </div>
    );
  }

  return (
    <h2
      className={`group m-0 inline-flex max-w-full items-baseline rounded-md px-1.5 py-0.5 text-[26px] font-semibold tracking-tight text-ink-900 ${
        disabled ? "cursor-default" : "cursor-text hover:bg-cream-100"
      }`}
      style={{ marginLeft: -6 }}
      onClick={() => {
        if (!disabled) setEditing(true);
      }}
      title={disabled ? undefined : "Click to rename"}
    >
      <span className="truncate">{kb.name}</span>
    </h2>
  );
}

function KbDocumentsTab({
  workspaceId,
  kbId,
  allKbs,
  isViewer,
}: {
  workspaceId: string;
  kbId: string;
  allKbs: KnowledgeBase[];
  isViewer: boolean;
}) {
  const { data, loading, error, refetch, setData } = useDocuments(workspaceId);
  const docs = (data ?? []).filter((d) => d.knowledge_base_id === kbId);

  return (
    <div className="flex flex-col gap-4">
      {!isViewer && (
        <DocumentUpload
          workspaceId={workspaceId}
          knowledgeBases={allKbs}
          defaultKbId={kbId}
          onUploaded={(doc) => {
            if (data) setData([doc, ...data]);
            else refetch();
          }}
        />
      )}
      {loading && (
        <div className="text-[12.5px] text-ink-500">Loading documents…</div>
      )}
      {error && !loading && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && (
        <DocumentList
          documents={docs}
          isViewer={isViewer}
          onDeleted={(id) =>
            setData((data ?? []).filter((d) => d.id !== id))
          }
        />
      )}
    </div>
  );
}

type ActionMode = "menu" | "move" | "copy";

function KbActionsMenu({
  kb,
  currentWorkspaceId,
  onMoved,
}: {
  kb: KnowledgeBase;
  currentWorkspaceId: string;
  onMoved: () => void;
}) {
  const navigate = useNavigate();
  const { workspaces, refetchWorkspaces } = useDashboard();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ActionMode>("menu");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const reset = () => {
    setOpen(false);
    setMode("menu");
    setConfirming(null);
    setError(null);
    setSuccess(null);
  };

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) reset();
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const targets = workspaces.filter((w) => w.id !== currentWorkspaceId);

  const move = async (targetId: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.knowledgeBases.move(kb.id, targetId);
      reset();
      refetchWorkspaces();
      onMoved();
      navigate(`/workspace/${targetId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (target: { id: string; name: string }) => {
    setBusy(true);
    setError(null);
    try {
      const newKb = await api.knowledgeBases.copy(kb.id, target.id);
      refetchWorkspaces();
      setConfirming(null);
      setSuccess(
        `Copied ${newKb.chunk_count} ${
          newKb.chunk_count === 1 ? "chunk" : "chunks"
        } to ${target.name}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        onClick={() => {
          if (open) reset();
          else {
            setOpen(true);
            setMode("menu");
          }
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 hover:bg-cream-200"
        title="More actions"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-8 z-30 w-[280px] rounded-lg border bg-white p-1.5 shadow-lg"
          style={{ borderColor: "rgba(67,55,39,0.18)" }}
        >
          {mode === "menu" && (
            <div className="flex flex-col">
              <button
                onClick={() => {
                  setMode("move");
                  setError(null);
                  setSuccess(null);
                  setConfirming(null);
                }}
                className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-ink-800 hover:bg-cream-100"
              >
                <MoveRight size={13} className="text-ink-500" />
                <span className="flex flex-col">
                  <span className="font-medium">Move to workspace…</span>
                  <span className="text-[11px] text-ink-500">
                    Relocate this KB to another workspace
                  </span>
                </span>
              </button>
              <button
                onClick={() => {
                  setMode("copy");
                  setError(null);
                  setSuccess(null);
                  setConfirming(null);
                }}
                className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-ink-800 hover:bg-cream-100"
              >
                <Copy size={13} className="text-ink-500" />
                <span className="flex flex-col">
                  <span className="font-medium">Copy to workspace…</span>
                  <span className="text-[11px] text-ink-500">
                    Duplicate this KB and its chunks
                  </span>
                </span>
              </button>
            </div>
          )}

          {(mode === "move" || mode === "copy") && (
            <>
              <button
                onClick={() => {
                  setMode("menu");
                  setConfirming(null);
                  setError(null);
                }}
                className="mb-1 flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-[11px] text-ink-500 hover:bg-cream-100"
              >
                <span>← Back</span>
              </button>
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-400">
                {mode === "move" ? (
                  <>
                    <MoveRight size={11} />
                    Move to workspace
                  </>
                ) : (
                  <>
                    <Copy size={11} />
                    Copy to workspace
                  </>
                )}
              </div>

              {targets.length === 0 ? (
                <div className="px-3 py-2.5 text-[12px] text-ink-500">
                  No other workspaces available. Create one to{" "}
                  {mode === "move" ? "move" : "copy"} knowledge bases between
                  workspaces.
                </div>
              ) : (
                <div className="max-h-[260px] overflow-y-auto">
                  {targets.map((w) => {
                    const isConfirming = confirming === w.id;
                    return (
                      <button
                        key={w.id}
                        onClick={() => {
                          if (!isConfirming) {
                            setConfirming(w.id);
                            return;
                          }
                          if (mode === "move") {
                            void move(w.id);
                          } else {
                            void copy({ id: w.id, name: w.name });
                          }
                        }}
                        disabled={busy}
                        className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-ink-800 hover:bg-cream-100 disabled:opacity-60"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-cream-50"
                            style={{ background: "#3a3320" }}
                          >
                            {w.name[0]?.toUpperCase() ?? "?"}
                          </span>
                          <span className="truncate">{w.name}</span>
                        </span>
                        {isConfirming ? (
                          <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-gold-400">
                            {busy ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : null}
                            {mode === "move" ? "Confirm move" : "Confirm copy"}
                          </span>
                        ) : (
                          <span className="text-[11px] text-ink-400">
                            {mode === "move" ? "Move →" : "Copy →"}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {error && (
            <div className="px-2.5 pb-2 pt-1 text-[11.5px] text-[#b04545]">
              {error}
            </div>
          )}
          {success && (
            <div className="px-2.5 pb-2 pt-1 text-[11.5px] text-[#3f7a55]">
              {success}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KbActivityTab({
  workspaceId,
  kbId,
}: {
  workspaceId: string;
  kbId: string;
}) {
  const { data, loading, error, refetch } = useHistory(workspaceId, {
    knowledge_base_id: kbId,
    limit: 50,
  });
  if (loading) return <div className="text-[12.5px] text-ink-500">Loading activity…</div>;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  return <HistoryTimeline sessions={data ?? []} />;
}
