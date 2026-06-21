import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BookOpen,
  Building2,
  FolderClosed,
  HelpCircle,
  Lock,
  Plus,
  Settings,
} from "lucide-react";
import type { User, WorkspaceSummary } from "../../lib/types";
import { api } from "../../lib/api";
import { useOrganizations } from "../../hooks/useOrganizations";
import { track } from "../../lib/analytics";

interface SidebarProps {
  workspaces: WorkspaceSummary[];
  activeId: string | null;
  user: User | null;
  onWorkspaceCreated: (ws: WorkspaceSummary) => void;
}

export function Sidebar({
  workspaces,
  activeId,
  user,
  onWorkspaceCreated,
}: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const orgsQ = useOrganizations();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newOrgId, setNewOrgId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || submitting) return;
    setSubmitting(true);
    setCreateError(null);
    try {
      const ws = await api.workspaces.create({
        name: newName.trim(),
        organization_id: newOrgId || undefined,
      });
      track("workspace.created");
      onWorkspaceCreated({
        ...ws,
        organization_id: ws.organization_id ?? null,
        kb_count: 0,
        chunk_count: 0,
        last_updated: ws.updated_at,
        members: [],
        role: "owner",
      });
      setNewName("");
      setNewOrgId("");
      setCreating(false);
      navigate(`/workspace/${ws.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const orgsActive = location.pathname.startsWith("/organizations");
  const settingsActive = location.pathname.startsWith("/settings");
  const orgs = orgsQ.data ?? [];

  const sortedWorkspaces = useMemo(
    () =>
      [...workspaces].sort((a, b) => {
        if (a.is_default && !b.is_default) return -1;
        if (!a.is_default && b.is_default) return 1;
        return a.name.localeCompare(b.name);
      }),
    [workspaces]
  );

  return (
    <aside
      className="flex h-full w-[240px] flex-shrink-0 flex-col bg-cream-200 px-3 py-[18px] border-r"
      style={{ borderColor: "rgba(24,24,27,0.12)" }}
    >
      <div className="flex items-center gap-2.5 px-2.5 pb-[18px] pt-1">
        <div
          className="flex h-6 w-6 items-center justify-center rounded-[7px] text-[11px] font-bold tracking-wider text-cream-50"
          style={{ background: "#3d5a80" }}
        >
          cn
        </div>
        <div className="text-sm font-semibold text-ink-900">ContextMaster</div>
      </div>

      <div className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-400">
        Workspaces
      </div>

      <div className="flex flex-1 flex-col gap-px overflow-y-auto">
        {sortedWorkspaces.length === 0 && (
          <div className="px-2.5 py-3 text-[12px] text-ink-500">
            No workspaces yet — create one below.
          </div>
        )}
        {sortedWorkspaces.map((w) => {
          const active = w.id === activeId;
          return (
            <button
              key={w.id}
              onClick={() => {
                if (w.id !== activeId) {
                  track("workspace.switched", { workspace_id: w.id });
                }
                navigate(`/workspace/${w.id}`);
              }}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                active
                  ? "text-ink-900"
                  : "text-ink-700 hover:bg-[rgba(24,24,27,0.04)]"
              }`}
              style={active ? { background: "rgba(24,24,27,0.08)" } : undefined}
            >
              <span
                className={`flex h-[22px] w-[22px] items-center justify-center rounded-md text-[11px] font-bold ${
                  active ? "text-cream-50" : "text-ink-700"
                }`}
                style={{ background: active ? "#18181b" : "#d1d5db" }}
              >
                {w.name[0]?.toUpperCase() ?? "?"}
              </span>
              <span className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <div
                    className={`truncate text-[13px] leading-tight ${
                      active ? "font-semibold" : "font-medium"
                    }`}
                  >
                    {w.name}
                  </div>
                  {w.retrieval_scope === "restricted" && (
                    <Lock
                      size={10}
                      className="shrink-0 text-ink-400"
                      aria-label="Restricted workspace"
                    />
                  )}
                </div>
                <div className="mt-0.5 text-[10.5px] text-ink-400">
                  {w.chunk_count} {w.chunk_count === 1 ? "item" : "items"}
                </div>
              </span>
            </button>
          );
        })}
      </div>

      {creating ? (
        <form
          onSubmit={submit}
          className="mt-2 flex flex-col gap-1.5"
        >
          <div
            className="flex items-start gap-2 rounded-md px-2 py-2 text-[11.5px] leading-snug text-ink-700"
            style={{ background: "rgba(24,24,27,0.05)" }}
          >
            <FolderClosed size={11} className="mt-0.5 shrink-0 text-ink-500" />
            <span>
              <span className="font-semibold text-ink-900">Workspaces</span>{" "}
              keep your projects separate and private. Create one for a team
              project, a client engagement, or anything that needs its own
              space. Your General workspace handles everything else.
            </span>
          </div>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Workspace name"
            className="rounded-lg border border-[rgba(24,24,27,0.18)] bg-cream-50 px-2.5 py-2 text-[13px] text-ink-800 outline-none placeholder:text-ink-500 focus:border-[rgba(24,24,27,0.4)]"
          />
          {orgs.length > 0 && (
            <select
              value={newOrgId}
              onChange={(e) => setNewOrgId(e.target.value)}
              className="rounded-lg border border-[rgba(24,24,27,0.18)] bg-cream-50 px-2.5 py-2 text-[12.5px] text-ink-800 outline-none"
            >
              <option value="">No organization (personal)</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  Link to {o.name}
                </option>
              ))}
            </select>
          )}
          {createError && (
            <div className="text-[11.5px] text-danger">{createError}</div>
          )}
          <div className="flex gap-1.5">
            <button
              type="submit"
              disabled={!newName.trim() || submitting}
              className="flex-1 rounded-lg bg-ink-800 px-2.5 py-1.5 text-[12px] font-medium text-cream-50 disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setNewName("");
                setNewOrgId("");
                setCreateError(null);
              }}
              className="rounded-lg border border-[rgba(24,24,27,0.18)] px-2.5 py-1.5 text-[12px] font-medium text-ink-700"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-[rgba(24,24,27,0.25)] bg-transparent px-2.5 py-2 text-[12.5px] font-medium text-ink-600 hover:bg-[rgba(24,24,27,0.04)]"
        >
          <Plus size={14} /> New workspace
        </button>
      )}

      <button
        onClick={() => navigate("/organizations")}
        className={`mt-1.5 flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] font-medium transition-colors ${
          orgsActive
            ? "text-ink-900"
            : "text-ink-700 hover:bg-[rgba(24,24,27,0.04)]"
        }`}
        style={
          orgsActive ? { background: "rgba(24,24,27,0.08)" } : undefined
        }
      >
        <Building2 size={14} /> Organizations
        {orgs.length > 0 && (
          <span className="ml-auto rounded-full bg-cream-300 px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-700">
            {orgs.length}
          </span>
        )}
      </button>

      <button
        onClick={() => navigate("/help")}
        className={`mt-0.5 flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] font-medium transition-colors ${
          location.pathname.startsWith("/help")
            ? "text-ink-900"
            : "text-ink-700 hover:bg-[rgba(24,24,27,0.04)]"
        }`}
        style={
          location.pathname.startsWith("/help")
            ? { background: "rgba(24,24,27,0.08)" }
            : undefined
        }
      >
        <HelpCircle size={14} /> Help
      </button>

      <button
        onClick={() => navigate("/onboarding")}
        className="mt-0.5 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11.5px] text-ink-500 transition-colors hover:bg-[rgba(24,24,27,0.04)] hover:text-ink-700"
      >
        <BookOpen size={12} /> Getting Started
      </button>

      {user && (
        <div
          className="mt-2 pt-1"
          style={{ borderTop: "0.5px solid rgba(24,24,27,0.10)" }}
        >
          <button
            onClick={() => navigate("/settings")}
            aria-label="Account settings"
            className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
              settingsActive
                ? "bg-[rgba(24,24,27,0.08)]"
                : "hover:bg-[rgba(24,24,27,0.04)]"
            }`}
          >
            <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-gold-400 text-[11px] font-bold text-cream-50">
              {(user.name ?? user.email)[0]?.toUpperCase() ?? "?"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <div className="truncate text-[12.5px] font-medium text-ink-900">
                  {user.name ?? user.email}
                </div>
                <span
                  className="shrink-0 rounded-full px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.06em]"
                  style={{
                    background: "rgba(61,90,128,0.18)",
                    color: "#3d5a80",
                  }}
                  title="Early Access — full access to all features"
                >
                  Early
                </span>
              </div>
              <div className="text-[10.5px] text-ink-400">{user.email}</div>
            </div>
            <Settings
              size={13}
              className={`shrink-0 transition-opacity ${
                settingsActive
                  ? "text-ink-700 opacity-100"
                  : "text-ink-400 opacity-0 group-hover:opacity-100"
              }`}
            />
          </button>
        </div>
      )}
    </aside>
  );
}
