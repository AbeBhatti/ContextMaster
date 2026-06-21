import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Plus, X } from "lucide-react";
import { useOrganization } from "../hooks/useOrganizations";
import { api, ApiError } from "../lib/api";
import { ErrorState } from "../components/common/ErrorState";
import { Skeleton } from "../components/common/LoadingSkeleton";
import {
  KB_TYPE_OPTIONS,
  avatarColor,
  colorsFor,
  formatRelativeTime,
  initialOf,
} from "../lib/constants";
import { templateFor } from "../lib/kbTemplates";
import type {
  OrganizationDetail,
  OrgMember,
  OrgRole,
  OrgSharedKb,
} from "../lib/types";

export function OrganizationPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const orgId = id ?? "";
  const { data, loading, error, refetch, setData } = useOrganization(orgId);

  if (loading) {
    return (
      <div className="flex-1 px-8 pb-8 pt-8">
        <div className="mx-auto flex max-w-4xl flex-col gap-3">
          <Skeleton className="h-7 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mt-3 h-32 w-full" />
        </div>
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return null;

  const isOwner = data.role === "owner";
  const isAdmin = isOwner || data.role === "admin";

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 pt-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div>
          <button
            onClick={() => navigate("/organizations")}
            className="mb-2 flex items-center gap-1.5 text-[12px] text-ink-500 hover:text-ink-700"
          >
            <ArrowLeft size={12} /> All organizations
          </button>
          <h1 className="m-0 text-[26px] font-semibold tracking-tight text-ink-900">
            {data.name}
          </h1>
          <div className="mt-1 text-[12.5px] text-ink-500">
            {data.members.length}{" "}
            {data.members.length === 1 ? "member" : "members"} ·{" "}
            {data.workspaces.length}{" "}
            {data.workspaces.length === 1 ? "workspace" : "workspaces"} ·{" "}
            {data.shared_knowledge_bases.length} shared KB
            {data.shared_knowledge_bases.length === 1 ? "" : "s"}
          </div>
        </div>

        <SharedKbsSection
          org={data}
          isAdmin={isAdmin}
          onCreated={(kb) =>
            setData({
              ...data,
              shared_knowledge_bases: [kb, ...data.shared_knowledge_bases],
            })
          }
        />

        <MembersSection
          org={data}
          isOwner={isOwner}
          isAdmin={isAdmin}
          onMembersChanged={(members) => setData({ ...data, members })}
        />

        <WorkspacesSection org={data} />
      </div>
    </div>
  );
}

function SharedKbsSection({
  org,
  isAdmin,
  onCreated,
}: {
  org: OrganizationDetail;
  isAdmin: boolean;
  onCreated: (kb: OrgSharedKb) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kbType, setKbType] = useState("general");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const kb = await api.organizations.createSharedKb(org.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        kb_type: kbType,
      });
      onCreated(kb);
      setName("");
      setDescription("");
      setKbType("general");
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      className="rounded-[9px] border bg-white p-4"
      style={{ borderColor: "rgba(67,55,39,0.10)" }}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-400">
          Shared knowledge bases
        </div>
        {isAdmin && !creating && (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] font-medium text-ink-700"
            style={{ borderColor: "rgba(67,55,39,0.18)" }}
          >
            <Plus size={11} /> New shared KB
          </button>
        )}
      </div>

      {creating && (
        <form
          onSubmit={submit}
          className="mb-3 flex flex-col gap-2 rounded-md border bg-cream-50 p-3"
          style={{ borderColor: "rgba(67,55,39,0.18)" }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="KB name"
            required
            className="rounded-md border bg-white px-2.5 py-1.5 text-[13px] outline-none"
            style={{ borderColor: "rgba(67,55,39,0.18)" }}
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={templateFor(kbType).description}
            rows={2}
            className="resize-vertical rounded-md border bg-white px-2.5 py-1.5 text-[13px] outline-none"
            style={{ borderColor: "rgba(67,55,39,0.18)" }}
          />
          <div className="flex items-center gap-2">
            <select
              value={kbType}
              onChange={(e) => setKbType(e.target.value)}
              className="rounded-md border bg-white px-2 py-1.5 text-[13px] outline-none"
              style={{ borderColor: "rgba(67,55,39,0.18)" }}
            >
              {KB_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setError(null);
              }}
              className="rounded-md border px-3 py-1.5 text-[12.5px] font-medium text-ink-700"
              style={{ borderColor: "rgba(67,55,39,0.18)" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="flex items-center gap-1.5 rounded-md bg-ink-800 px-3 py-1.5 text-[12.5px] font-medium text-cream-50 disabled:opacity-50"
            >
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Create
            </button>
          </div>
          {error && (
            <div className="text-[12px] text-[#b04545]">{error}</div>
          )}
        </form>
      )}

      {org.shared_knowledge_bases.length === 0 && !creating && (
        <div className="text-[12.5px] text-ink-500">
          No shared knowledge bases yet. They will appear in every member's
          AI sessions under <code>shared_knowledge_bases</code>.
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {org.shared_knowledge_bases.map((kb) => {
          const tc = colorsFor(kb.kb_type);
          return (
            <div
              key={kb.id}
              className="flex items-center gap-3 rounded-md border bg-cream-50 p-2.5"
              style={{
                borderColor: "rgba(67,55,39,0.10)",
                borderStyle: "dashed",
              }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: tc.dot }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink-900">
                  {kb.name}
                </div>
                {kb.description && (
                  <div className="truncate text-[11.5px] text-ink-500">
                    {kb.description}
                  </div>
                )}
              </div>
              <span className="rounded-full bg-cream-300 px-2 py-0.5 text-[11px] capitalize text-ink-700">
                {kb.kb_type}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MembersSection({
  org,
  isOwner,
  isAdmin,
  onMembersChanged,
}: {
  org: OrganizationDetail;
  isOwner: boolean;
  isAdmin: boolean;
  onMembersChanged: (members: OrgMember[]) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.organizations.addMember(org.id, {
        email: email.trim(),
        role,
      });
      // Refresh members from server to capture the user's name/email.
      const fresh = await api.organizations.get(org.id);
      onMembersChanged(fresh.members);
      setEmail("");
      setRole("member");
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 404
          ? "No user with that email yet. They must sign up first."
          : err instanceof Error
          ? err.message
          : String(err);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (userId: string) => {
    if (!confirm("Remove this member from the organization?")) return;
    try {
      await api.organizations.removeMember(org.id, userId);
      onMembersChanged(org.members.filter((m) => m.user_id !== userId));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const changeRole = async (userId: string, newRole: OrgRole) => {
    try {
      await api.organizations.updateMemberRole(org.id, userId, newRole);
      onMembersChanged(
        org.members.map((m) =>
          m.user_id === userId ? { ...m, role: newRole } : m
        )
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section
      className="rounded-[9px] border bg-white p-4"
      style={{ borderColor: "rgba(67,55,39,0.10)" }}
    >
      <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-400">
        Members ({org.members.length})
      </div>

      {isAdmin && (
        <form
          onSubmit={submit}
          className="mb-3 flex flex-wrap items-center gap-2"
        >
          <input
            type="email"
            required
            placeholder="teammate@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded-md border bg-cream-50 px-2.5 py-1.5 text-[13px] text-ink-800 outline-none"
            style={{ borderColor: "rgba(67,55,39,0.18)" }}
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as OrgRole)}
            className="rounded-md border bg-cream-50 px-2 py-1.5 text-[13px] text-ink-800 outline-none"
            style={{ borderColor: "rgba(67,55,39,0.18)" }}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="submit"
            disabled={!email.trim() || submitting}
            className="flex items-center gap-1.5 rounded-md bg-ink-800 px-3 py-1.5 text-[13px] font-medium text-cream-50 disabled:opacity-50"
          >
            {submitting && <Loader2 size={12} className="animate-spin" />}
            Add
          </button>
        </form>
      )}
      {error && (
        <div className="mb-2 text-[12px] text-[#b04545]">{error}</div>
      )}

      <div className="flex flex-col gap-1.5">
        {org.members.map((m) => (
          <div
            key={m.user_id}
            className="flex items-center gap-3 rounded-md border bg-cream-50 p-2.5"
            style={{ borderColor: "rgba(67,55,39,0.10)" }}
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full text-[10.5px] font-bold text-cream-50"
              style={{ background: avatarColor(m.user_id) }}
            >
              {initialOf(m.name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-ink-900">
                {m.name}
              </div>
              {m.email && (
                <div className="truncate text-[11.5px] text-ink-500">
                  {m.email}
                </div>
              )}
            </div>
            {isOwner && m.user_id !== org.owner_id ? (
              <select
                value={m.role}
                onChange={(e) =>
                  changeRole(m.user_id, e.target.value as OrgRole)
                }
                className="rounded-md border bg-white px-2 py-0.5 text-[11.5px] capitalize"
                style={{ borderColor: "rgba(67,55,39,0.18)" }}
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            ) : (
              <span className="rounded-full bg-cream-300 px-2 py-0.5 text-[11px] capitalize text-ink-700">
                {m.role}
              </span>
            )}
            {isAdmin && m.user_id !== org.owner_id && (
              <button
                onClick={() => remove(m.user_id)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 hover:bg-cream-200"
                title="Remove from organization"
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function WorkspacesSection({ org }: { org: OrganizationDetail }) {
  if (org.workspaces.length === 0) return null;
  return (
    <section
      className="rounded-[9px] border bg-white p-4"
      style={{ borderColor: "rgba(67,55,39,0.10)" }}
    >
      <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-400">
        Linked workspaces
      </div>
      <div className="flex flex-col gap-1.5">
        {org.workspaces.map((ws) => (
          <Link
            key={ws.id}
            to={`/workspace/${ws.id}`}
            className="flex items-center gap-3 rounded-md border bg-cream-50 p-2.5 hover:bg-cream-100"
            style={{ borderColor: "rgba(67,55,39,0.10)" }}
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-bold text-cream-50"
              style={{ background: "#cfc3a5" }}
            >
              {ws.name[0]?.toUpperCase() ?? "?"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-ink-900">
                {ws.name}
              </div>
              {ws.description && (
                <div className="truncate text-[11.5px] text-ink-500">
                  {ws.description}
                </div>
              )}
            </div>
            <span className="text-[11px] text-ink-500">
              updated {formatRelativeTime(ws.updated_at)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
