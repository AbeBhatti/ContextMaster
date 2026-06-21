import { useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Loader2, Plus } from "lucide-react";
import { useOrganizations } from "../hooks/useOrganizations";
import { api } from "../lib/api";
import { ErrorState } from "../components/common/ErrorState";
import { Skeleton } from "../components/common/LoadingSkeleton";
import { formatRelativeTime } from "../lib/constants";

export function OrganizationsPage() {
  const { data, loading, error, refetch, setData } = useOrganizations();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setCreateError(null);
    try {
      const org = await api.organizations.create({ name: name.trim() });
      setData([
        {
          ...org,
          role: "owner",
          member_count: 1,
          workspace_count: 0,
        },
        ...(data ?? []),
      ]);
      setName("");
      setCreating(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 pt-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[11.5px] font-medium text-ink-400">
              Organizations
            </div>
            <h1 className="m-0 mt-1 text-[26px] font-semibold tracking-tight text-ink-900">
              Your organizations
            </h1>
            <p className="m-0 mt-1 max-w-[520px] text-[13px] text-ink-600">
              Group teammates into an organization to share knowledge bases
              across multiple workspaces.
            </p>
          </div>
          {!creating && (
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded-md bg-ink-800 px-3 py-2 text-[13px] font-medium text-cream-50"
            >
              <Plus size={14} /> New organization
            </button>
          )}
        </div>

        {creating && (
          <div className="flex flex-col gap-2">
            <OrgExplainer />
            <form
              onSubmit={submit}
              className="flex items-center gap-2 rounded-[9px] border bg-white p-3"
              style={{ borderColor: "rgba(24,24,27,0.10)" }}
            >
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Organization name"
                required
                className="flex-1 rounded-md border bg-cream-50 px-2.5 py-1.5 text-[13px] text-ink-800 outline-none"
                style={{ borderColor: "rgba(24,24,27,0.18)" }}
              />
              <button
                type="submit"
                disabled={!name.trim() || submitting}
                className="flex items-center gap-1.5 rounded-md bg-ink-800 px-3 py-1.5 text-[13px] font-medium text-cream-50 disabled:opacity-50"
              >
                {submitting && <Loader2 size={12} className="animate-spin" />}
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setName("");
                  setCreateError(null);
                }}
                className="rounded-md border px-3 py-1.5 text-[13px] font-medium text-ink-700"
                style={{ borderColor: "rgba(24,24,27,0.18)" }}
              >
                Cancel
              </button>
            </form>
          </div>
        )}
        {createError && (
          <div className="text-[12px] text-danger">{createError}</div>
        )}

        {loading && (
          <div className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}
        {error && !loading && <ErrorState message={error} onRetry={refetch} />}
        {!loading && !error && (data ?? []).length === 0 && !creating && (
          <>
            <OrgExplainer />
            <div
              className="rounded-[9px] border bg-white p-6 text-center"
              style={{ borderColor: "rgba(24,24,27,0.10)" }}
            >
              <Building2 size={20} className="mx-auto text-ink-400" />
              <div className="mt-2 text-[13px] font-medium text-ink-800">
                No organizations yet
              </div>
              <div className="mt-1 text-[12px] text-ink-500">
                Create one to share knowledge bases across teammates.
              </div>
            </div>
          </>
        )}

        <div className="flex flex-col gap-2">
          {(data ?? []).map((org) => (
            <Link
              key={org.id}
              to={`/organizations/${org.id}`}
              className="flex items-center gap-3 rounded-[9px] border bg-white p-3 transition-colors hover:bg-cream-100"
              style={{ borderColor: "rgba(24,24,27,0.10)" }}
            >
              <span
                className="flex h-9 w-9 items-center justify-center rounded-md text-[12px] font-bold text-cream-50"
                style={{ background: "#3d5a80" }}
              >
                {org.name[0]?.toUpperCase() ?? "?"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium text-ink-900">
                  {org.name}
                </div>
                <div className="text-[11.5px] text-ink-500">
                  {org.member_count}{" "}
                  {org.member_count === 1 ? "member" : "members"} ·{" "}
                  {org.workspace_count}{" "}
                  {org.workspace_count === 1 ? "workspace" : "workspaces"} ·
                  created {formatRelativeTime(org.created_at)}
                </div>
              </div>
              <span className="rounded-full bg-cream-300 px-2 py-0.5 text-[11px] capitalize text-ink-700">
                {org.role}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function OrgExplainer() {
  return (
    <div
      className="flex items-start gap-2 rounded-[9px] px-3 py-2.5 text-[12.5px] leading-snug text-ink-700"
      style={{ background: "rgba(24,24,27,0.05)" }}
    >
      <Building2 size={13} className="mt-0.5 shrink-0 text-ink-500" />
      <span>
        <span className="font-semibold text-ink-900">Organizations</span>{" "}
        connect your team across multiple workspaces. Create shared knowledge
        bases that are available to every member, regardless of which workspace
        they're working in — like company policies, methodology guides, or team
        conventions.
      </span>
    </div>
  );
}
