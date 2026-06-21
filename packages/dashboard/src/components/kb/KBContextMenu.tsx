import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  Copy,
  FolderInput,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import type { WorkspaceSummary } from "../../lib/types";

type Mode = "menu" | "move" | "copy" | "delete";

export interface KBContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  kbId: string | null;
  kbName: string | null;
  chunkCount: number;
}

const INITIAL_STATE: KBContextMenuState = {
  isOpen: false,
  x: 0,
  y: 0,
  kbId: null,
  kbName: null,
  chunkCount: 0,
};

export function useKBContextMenu() {
  const [state, setState] = useState<KBContextMenuState>(INITIAL_STATE);

  const openMenu = useCallback(
    (
      event: React.MouseEvent | MouseEvent,
      kbId: string,
      kbName: string,
      chunkCount: number
    ) => {
      event.preventDefault();
      setState({
        isOpen: true,
        x: event.clientX,
        y: event.clientY,
        kbId,
        kbName,
        chunkCount,
      });
    },
    []
  );

  const closeMenu = useCallback(() => {
    setState((s) => (s.isOpen ? { ...s, isOpen: false } : s));
  }, []);

  return { state, openMenu, closeMenu };
}

interface KBContextMenuProps {
  state: KBContextMenuState;
  onClose: () => void;
  onRename: () => void;
  onMoveConfirm: (targetWorkspaceId: string) => Promise<void>;
  onCopyConfirm: (targetWorkspaceId: string) => Promise<void>;
  onDeleteConfirm: () => Promise<void>;
  workspaces: WorkspaceSummary[];
  currentWorkspaceId: string;
}

const HOVER_TINT = "rgba(67,55,39,0.06)";
const HOVER_BORDER = "rgba(67,55,39,0.12)";
const DANGER = "#b04545";
const VIEWPORT_PAD = 8;

export function KBContextMenu({
  state,
  onClose,
  onRename,
  onMoveConfirm,
  onCopyConfirm,
  onDeleteConfirm,
  workspaces,
  currentWorkspaceId,
}: KBContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("menu");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [adjusted, setAdjusted] = useState<{ left: number; top: number }>({
    left: state.x,
    top: state.y,
  });

  // Reset internal state whenever the menu opens fresh.
  useEffect(() => {
    if (state.isOpen) {
      setMode("menu");
      setBusy(false);
      setError(null);
      setConfirmText("");
    }
  }, [state.isOpen, state.kbId]);

  useLayoutEffect(() => {
    if (!state.isOpen) return;
    const el = menuRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el?.offsetWidth ?? 220;
    const h = el?.offsetHeight ?? 200;
    let left = state.x;
    let top = state.y;
    if (left + w + VIEWPORT_PAD > vw)
      left = Math.max(VIEWPORT_PAD, vw - w - VIEWPORT_PAD);
    if (top + h + VIEWPORT_PAD > vh)
      top = Math.max(VIEWPORT_PAD, vh - h - VIEWPORT_PAD);
    setAdjusted({ left, top });
  }, [state.isOpen, state.x, state.y, mode]);

  useEffect(() => {
    if (!state.isOpen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (busy) return;
        if (mode === "menu") onClose();
        else setMode("menu");
      }
    };
    const onScroll = (e: Event) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      onClose();
    };
    const onPointerDown = (e: MouseEvent) => {
      if (busy) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [state.isOpen, onClose, mode, busy]);

  const targets = useMemo(
    () => workspaces.filter((w) => w.id !== currentWorkspaceId),
    [workspaces, currentWorkspaceId]
  );

  if (!state.isOpen || !state.kbId || !state.kbName) return null;

  const runMove = async (workspaceId: string) => {
    setBusy(true);
    setError(null);
    try {
      await onMoveConfirm(workspaceId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const runCopy = async (workspaceId: string) => {
    setBusy(true);
    setError(null);
    try {
      await onCopyConfirm(workspaceId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const runDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDeleteConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const widthByMode: Record<Mode, number> = {
    menu: 200,
    move: 240,
    copy: 240,
    delete: 260,
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-[60] rounded-lg bg-cream-50 shadow-xl"
      style={{
        left: adjusted.left,
        top: adjusted.top,
        width: widthByMode[mode],
        border: "0.5px solid rgba(67,55,39,0.18)",
        boxShadow:
          "0 10px 24px rgba(58,51,32,.18), 0 2px 4px rgba(58,51,32,.08)",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Header
        mode={mode}
        kbName={state.kbName}
        onBack={() => {
          if (!busy) {
            setMode("menu");
            setError(null);
            setConfirmText("");
          }
        }}
      />

      {mode === "menu" && (
        <div className="flex flex-col py-1">
          <MenuItem
            icon={<Pencil size={13} />}
            label="Rename"
            onClick={() => {
              onRename();
              onClose();
            }}
          />
          <MenuItem
            icon={<FolderInput size={13} />}
            label="Move to workspace"
            onClick={() => setMode("move")}
          />
          <MenuItem
            icon={<Copy size={13} />}
            label="Copy to workspace"
            onClick={() => setMode("copy")}
          />
          <MenuItem
            icon={<Trash2 size={13} />}
            label="Delete"
            danger
            onClick={() => setMode("delete")}
          />
        </div>
      )}

      {(mode === "move" || mode === "copy") && (
        <div className="flex flex-col gap-1 p-1.5">
          {targets.length === 0 ? (
            <div className="px-2 py-3 text-[12px] leading-snug text-ink-600">
              No other workspaces available. Create another workspace first.
            </div>
          ) : (
            <div className="flex max-h-[220px] flex-col gap-1 overflow-y-auto">
              {targets.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    mode === "move" ? runMove(w.id) : runCopy(w.id)
                  }
                  className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors disabled:opacity-50"
                  style={{
                    background: "transparent",
                    border: "1px solid transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (busy) return;
                    e.currentTarget.style.background = HOVER_TINT;
                    e.currentTarget.style.borderColor = HOVER_BORDER;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.borderColor = "transparent";
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium text-ink-800">
                      {w.name}
                    </div>
                    <div className="text-[10.5px] text-ink-500">
                      {w.kb_count} {w.kb_count === 1 ? "KB" : "KBs"} · {w.role}
                    </div>
                  </div>
                  {busy && (
                    <Loader2 size={12} className="animate-spin text-ink-500" />
                  )}
                </button>
              ))}
            </div>
          )}
          {error && (
            <div className="px-2 pt-1 text-[11.5px]" style={{ color: DANGER }}>
              {error}
            </div>
          )}
        </div>
      )}

      {mode === "delete" && (
        <div className="flex flex-col gap-2.5 p-3">
          <div className="text-[12px] leading-snug text-ink-700">
            Permanently delete{" "}
            <span className="font-semibold text-ink-900">{state.kbName}</span>{" "}
            and its {state.chunkCount}{" "}
            {state.chunkCount === 1 ? "chunk" : "chunks"}. This cannot be undone.
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Type name to confirm
            </span>
            <input
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  confirmText.trim() === state.kbName?.trim() &&
                  !busy
                ) {
                  e.preventDefault();
                  void runDelete();
                }
              }}
              placeholder={state.kbName ?? ""}
              disabled={busy}
              className="rounded-md border bg-white px-2 py-1.5 text-[12.5px] text-ink-900 outline-none placeholder:text-ink-400 disabled:opacity-60"
              style={{
                borderColor:
                  confirmText.trim() === state.kbName?.trim()
                    ? "rgba(176,69,69,0.5)"
                    : "rgba(67,55,39,0.18)",
              }}
            />
          </label>

          {error && (
            <div className="text-[11.5px]" style={{ color: DANGER }}>
              {error}
            </div>
          )}

          <button
            type="button"
            disabled={confirmText.trim() !== state.kbName?.trim() || busy}
            onClick={runDelete}
            className="flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-semibold text-cream-50 disabled:opacity-50"
            style={{ background: DANGER }}
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function Header({
  mode,
  kbName,
  onBack,
}: {
  mode: Mode;
  kbName: string;
  onBack: () => void;
}) {
  const subtitle =
    mode === "move"
      ? "Move to"
      : mode === "copy"
      ? "Copy to"
      : mode === "delete"
      ? "Delete"
      : null;

  return (
    <div
      className="flex items-center gap-1.5 px-3 pt-2.5 pb-2"
      style={{ borderBottom: "0.5px solid rgba(67,55,39,0.10)" }}
    >
      {subtitle && (
        <button
          type="button"
          onClick={onBack}
          className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm text-ink-500 hover:bg-cream-200"
          aria-label="Back"
        >
          <ArrowLeft size={12} />
        </button>
      )}
      <div className="min-w-0 flex-1">
        {subtitle && (
          <div
            className="text-[9.5px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: mode === "delete" ? DANGER : "#8a7c5e" }}
          >
            {subtitle}
          </div>
        )}
        <div
          className="truncate text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-400"
          title={kbName}
          style={subtitle ? undefined : { paddingTop: 0 }}
        >
          {kbName}
        </div>
      </div>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-1.5 text-left text-[13px] font-medium"
      style={{
        color: danger ? DANGER : "#3a3320",
        background: "transparent",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger
          ? "rgba(176,69,69,0.08)"
          : "rgba(67,55,39,0.06)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span
        className="flex h-4 w-4 items-center justify-center"
        style={{ color: danger ? DANGER : "#6b6049" }}
      >
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}
