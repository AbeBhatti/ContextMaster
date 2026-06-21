import { useNavigate } from "react-router-dom";
import { Eye, Plus } from "lucide-react";
import type { WorkspaceDetail } from "../../lib/types";
import { avatarColor, formatRelativeTime, initialOf } from "../../lib/constants";

export type TabId =
  | "graph"
  | "list"
  | "history"
  | "documents"
  | "team"
  | "settings";

interface TabDef {
  id: TabId;
  label: string;
}

const ALL_TABS: TabDef[] = [
  { id: "graph", label: "Graph" },
  { id: "list", label: "List" },
  { id: "history", label: "History" },
  { id: "documents", label: "Documents" },
  { id: "team", label: "Team" },
  { id: "settings", label: "Settings" },
];

interface WorkspaceHeaderProps {
  workspace: WorkspaceDetail;
  activeTab: TabId;
  onInvite?: () => void;
  onCreateKb?: () => void;
}

export function WorkspaceHeader({
  workspace,
  activeTab,
  onInvite,
  onCreateKb,
}: WorkspaceHeaderProps) {
  const navigate = useNavigate();
  const tabs = workspace.is_default
    ? ALL_TABS.filter((t) => t.id !== "team")
    : ALL_TABS;

  const memberCount = workspace.members.length;
  const visibleAvatars = workspace.members.slice(0, 3);
  const overflow = memberCount - visibleAvatars.length;
  const visibleKbs = workspace.knowledge_bases.length;

  const isViewer = workspace.role === "viewer";

  return (
    <header className="flex-shrink-0 px-8 pt-6">
      {isViewer && (
        <div
          className="mb-3 flex items-center gap-2 rounded-md border bg-cream-100 px-3 py-1.5 text-[12px] text-ink-700"
          style={{ borderColor: "rgba(67,55,39,0.18)" }}
        >
          <Eye size={12} />
          You have view-only access to this workspace. Ask the workspace owner to
          upgrade your role to editor to commit changes.
        </div>
      )}
      <div className="mb-[18px] flex items-end justify-between">
        <div className="min-w-0">
          <div className="mb-1 text-[11.5px] font-medium text-ink-400">
            {workspace.is_default ? "Personal" : `Shared · ${memberCount}`} ·{" "}
            {visibleKbs} {visibleKbs === 1 ? "knowledge base" : "knowledge bases"}{" "}
            · updated {formatRelativeTime(workspace.updated_at)}
          </div>
          <h1 className="m-0 text-[30px] font-semibold tracking-tight text-ink-900">
            {workspace.name}
          </h1>
          {workspace.description && (
            <p className="m-0 mt-1 max-w-[540px] text-sm text-ink-600">
              {workspace.description}
            </p>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {visibleAvatars.length > 0 && (
            <div className="flex items-center">
              {visibleAvatars.map((m, i) => (
                <span
                  key={m.user_id}
                  className="flex h-[26px] w-[26px] items-center justify-center rounded-full text-[10.5px] font-bold text-cream-50"
                  style={{
                    background: avatarColor(m.user_id),
                    border: "2px solid #fffaf0",
                    marginLeft: i === 0 ? 0 : -8,
                  }}
                  title={m.name}
                >
                  {initialOf(m.name)}
                </span>
              ))}
              {overflow > 0 && (
                <span
                  className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-cream-500 text-[10.5px] font-bold text-ink-700"
                  style={{ border: "2px solid #fffaf0", marginLeft: -8 }}
                >
                  +{overflow}
                </span>
              )}
            </div>
          )}
          {onCreateKb && (
            <button
              onClick={onCreateKb}
              className="flex items-center gap-1.5 rounded-lg border border-[rgba(67,55,39,0.18)] bg-cream-50 px-3 py-[7px] text-[12.5px] font-medium text-ink-800 hover:bg-cream-100"
            >
              <Plus size={12} /> New knowledge base
            </button>
          )}
          {!workspace.is_default && onInvite && (
            <button
              onClick={onInvite}
              className="rounded-lg border border-[rgba(67,55,39,0.18)] bg-cream-50 px-3 py-[7px] text-[12.5px] font-medium text-ink-800 hover:bg-cream-100"
            >
              Invite
            </button>
          )}
        </div>
      </div>
      <div
        className="flex gap-0.5"
        style={{ borderBottom: "0.5px solid rgba(67,55,39,0.12)" }}
      >
        {tabs.map((t) => {
          const active = t.id === activeTab;
          return (
            <button
              key={t.id}
              onClick={() => navigate(`/workspace/${workspace.id}/${t.id}`)}
              className={`px-3.5 py-2.5 text-[13px] font-medium transition-colors ${
                active ? "text-ink-900" : "text-ink-500 hover:text-ink-700"
              }`}
              style={{
                borderBottom: active
                  ? "2px solid #3a3320"
                  : "2px solid transparent",
                marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </header>
  );
}
