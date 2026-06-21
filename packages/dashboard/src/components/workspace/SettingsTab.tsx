import { useState } from "react";
import { Loader2, Lock, Unlock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import type { RetrievalScope, WorkspaceDetail } from "../../lib/types";

interface SettingsTabProps {
  workspace: WorkspaceDetail;
  onWorkspaceUpdated: (
    patch: Partial<
      Pick<WorkspaceDetail, "name" | "description" | "retrieval_scope">
    >
  ) => void;
  onWorkspaceDeleted: () => void;
}

export function SettingsTab({
  workspace,
  onWorkspaceUpdated,
  onWorkspaceDeleted,
}: SettingsTabProps) {
  const navigate = useNavigate();
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description ?? "");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dirty =
    name !== workspace.name || description !== (workspace.description ?? "");

  const isOwner = workspace.role === "owner";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.workspaces.update(workspace.id, {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      onWorkspaceUpdated({
        name: updated.name,
        description: updated.description,
      });
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const performDelete = async () => {
    setDeleting(true);
    try {
      await api.workspaces.delete(workspace.id);
      onWorkspaceDeleted();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 pt-5">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <form
          onSubmit={save}
          className="flex flex-col gap-3 rounded-[10px] border bg-white p-4"
          style={{ borderColor: "rgba(24,24,27,0.10)" }}
        >
          <div className="text-[14px] font-semibold text-ink-800">
            Workspace details
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-400">
              Name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isOwner}
              required
              className="rounded-md border bg-cream-50 px-2.5 py-1.5 text-[13px] text-ink-900 outline-none disabled:opacity-60"
              style={{ borderColor: "rgba(24,24,27,0.18)" }}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-400">
              Description
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!isOwner}
              rows={3}
              className="resize-vertical rounded-md border bg-cream-50 px-2.5 py-1.5 text-[13px] text-ink-900 outline-none disabled:opacity-60"
              style={{ borderColor: "rgba(24,24,27,0.18)" }}
            />
          </label>
          {error && (
            <div className="text-[12px] text-danger">{error}</div>
          )}
          {!isOwner ? (
            <div className="text-[12px] text-ink-500">
              Only the workspace owner can edit these.
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              {savedAt && !dirty && (
                <span className="text-[12px] text-success">Saved</span>
              )}
              <button
                type="submit"
                disabled={!dirty || !name.trim() || saving}
                className="flex items-center gap-1.5 rounded-md bg-ink-800 px-3 py-1.5 text-[12.5px] font-medium text-cream-50 disabled:opacity-50"
              >
                {saving && <Loader2 size={12} className="animate-spin" />}
                Save changes
              </button>
            </div>
          )}
        </form>

        {isOwner && (
          <PrivacySection
            workspace={workspace}
            onUpdated={(scope) =>
              onWorkspaceUpdated({ retrieval_scope: scope })
            }
          />
        )}

        {isOwner && !workspace.is_default && (
          <div
            className="rounded-[10px] border p-4"
            style={{ borderColor: "rgba(220,38,38,0.4)" }}
          >
            <div className="text-[13px] font-semibold text-danger">
              Delete workspace
            </div>
            <div className="mt-1 text-[12px] text-ink-500">
              This permanently deletes the workspace, its knowledge bases, and
              all chunks. Members will lose access immediately.
            </div>
            {confirmingDelete ? (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-[12px] text-ink-700">
                  Are you sure?
                </span>
                <button
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                  className="rounded-md border px-2.5 py-1 text-[12px] text-ink-700"
                  style={{ borderColor: "rgba(24,24,27,0.18)" }}
                >
                  Cancel
                </button>
                <button
                  onClick={performDelete}
                  disabled={deleting}
                  className="flex items-center gap-1.5 rounded-md bg-danger px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-60"
                >
                  {deleting && <Loader2 size={12} className="animate-spin" />}
                  Delete forever
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmingDelete(true)}
                className="mt-3 rounded-md border bg-white px-3 py-1.5 text-[12px] font-medium text-danger"
                style={{ borderColor: "rgba(220,38,38,0.4)" }}
              >
                Delete this workspace
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PrivacySection({
  workspace,
  onUpdated,
}: {
  workspace: WorkspaceDetail;
  onUpdated: (scope: RetrievalScope) => void;
}) {
  const initial: RetrievalScope = workspace.retrieval_scope ?? "open";
  const [scope, setScope] = useState<RetrievalScope>(initial);
  const [saving, setSaving] = useState<RetrievalScope | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = async (next: RetrievalScope) => {
    if (next === scope || saving) return;
    setSaving(next);
    setError(null);
    try {
      const updated = await api.workspaces.update(workspace.id, {
        retrieval_scope: next,
      });
      const newScope = (updated.retrieval_scope ?? next) as RetrievalScope;
      setScope(newScope);
      onUpdated(newScope);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  };

  const options: Array<{
    value: RetrievalScope;
    title: string;
    body: string;
    icon: typeof Lock;
  }> = [
    {
      value: "open",
      title: "Open",
      body: "This workspace's knowledge is available in all your sessions.",
      icon: Unlock,
    },
    {
      value: "restricted",
      title: "Restricted",
      body: "This workspace's knowledge is only available when you're working directly in it.",
      icon: Lock,
    },
  ];

  return (
    <section
      className="rounded-[10px] border bg-white p-4"
      style={{ borderColor: "rgba(24,24,27,0.10)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[14px] font-semibold text-ink-800">
            Workspace privacy
          </div>
          <div className="mt-0.5 text-[12px] text-ink-500">
            Controls when this workspace's knowledge bases surface in AI
            sessions outside this workspace.
          </div>
        </div>
        {scope === "restricted" && (
          <span className="flex items-center gap-1 rounded-full bg-cream-300 px-2 py-0.5 text-[10.5px] font-semibold text-ink-700">
            <Lock size={10} /> Restricted
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const active = scope === opt.value;
          const isSaving = saving === opt.value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => apply(opt.value)}
              disabled={!!saving}
              className="flex items-start gap-2.5 rounded-[10px] border px-3 py-3 text-left transition-all disabled:opacity-70"
              style={{
                borderColor: active
                  ? "rgba(61,90,128,0.55)"
                  : "rgba(24,24,27,0.14)",
                background: active ? "rgba(61,90,128,0.10)" : "white",
              }}
            >
              <span
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                style={{
                  background: active ? "rgba(61,90,128,0.25)" : "#f5f6f7",
                  color: active ? "#3d5a80" : "#52525b",
                }}
              >
                {isSaving ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Icon size={13} />
                )}
              </span>
              <div>
                <div className="text-[13px] font-semibold text-ink-900">
                  {opt.title}
                </div>
                <div className="mt-0.5 text-[12px] leading-snug text-ink-600">
                  {opt.body}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {error && (
        <div className="mt-2 text-[12px] text-danger">{error}</div>
      )}
    </section>
  );
}
