import { useState } from "react";
import { Loader2, X } from "lucide-react";
import type { Invite, WorkspaceMember, WorkspaceRole } from "../../lib/types";
import { avatarColor, formatTimeUntil, initialOf } from "../../lib/constants";
import { api } from "../../lib/api";

interface MemberListProps {
  workspaceId: string;
  members: WorkspaceMember[];
  invites: Invite[];
  isOwner: boolean;
  ownerId?: string;
  onInviteRevoked: (inviteId: string) => void;
  onMemberChanged?: (userId: string, role: WorkspaceRole) => void;
  onMemberRemoved?: (userId: string) => void;
}

export function MemberList({
  workspaceId,
  members,
  invites,
  isOwner,
  ownerId,
  onInviteRevoked,
  onMemberChanged,
  onMemberRemoved,
}: MemberListProps) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyMember, setBusyMember] = useState<string | null>(null);

  const revoke = async (inviteId: string) => {
    setRevoking(inviteId);
    setError(null);
    try {
      await api.team.revokeInvite(workspaceId, inviteId);
      onInviteRevoked(inviteId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevoking(null);
    }
  };

  const changeRole = async (userId: string, role: WorkspaceRole) => {
    setBusyMember(userId);
    setError(null);
    try {
      await api.team.updateMemberRole(workspaceId, userId, role);
      onMemberChanged?.(userId, role);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMember(null);
    }
  };

  const remove = async (userId: string) => {
    if (!confirm("Remove this member from the workspace?")) return;
    setBusyMember(userId);
    setError(null);
    try {
      await api.team.removeMember(workspaceId, userId);
      onMemberRemoved?.(userId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMember(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section>
        <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-400">
          Members ({members.length})
        </div>
        {error && (
          <div className="mb-2 text-[12px] text-[#b04545]">{error}</div>
        )}
        <div className="flex flex-col gap-1.5">
          {members.map((m) => {
            const isWorkspaceOwner = m.user_id === ownerId;
            const canEdit = isOwner && !isWorkspaceOwner;
            const role = (m.role ?? "editor") as WorkspaceRole;
            return (
            <div
              key={m.user_id}
              className="flex items-center gap-3 rounded-[9px] border bg-white p-3"
              style={{ borderColor: "rgba(67,55,39,0.10)" }}
            >
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-cream-50"
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
              {canEdit ? (
                <select
                  value={role}
                  disabled={busyMember === m.user_id}
                  onChange={(e) =>
                    void changeRole(
                      m.user_id,
                      e.target.value as WorkspaceRole
                    )
                  }
                  className="rounded-md border bg-cream-50 px-2 py-0.5 text-[11.5px] capitalize"
                  style={{ borderColor: "rgba(67,55,39,0.18)" }}
                >
                  <option value="viewer">viewer</option>
                  <option value="editor">editor</option>
                </select>
              ) : (
                <span className="rounded-full bg-cream-300 px-2 py-0.5 text-[11px] capitalize text-ink-700">
                  {role}
                </span>
              )}
              {canEdit && (
                <button
                  onClick={() => void remove(m.user_id)}
                  disabled={busyMember === m.user_id}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 hover:bg-cream-200 disabled:opacity-50"
                  title="Remove from workspace"
                >
                  {busyMember === m.user_id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <X size={12} />
                  )}
                </button>
              )}
            </div>
            );
          })}
        </div>
      </section>

      {invites.length > 0 && (
        <section>
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-400">
            Pending invites ({invites.length})
          </div>
          {error && (
            <div className="mb-2 text-[12px] text-[#b04545]">{error}</div>
          )}
          <div className="flex flex-col gap-1.5">
            {invites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center gap-3 rounded-[9px] border bg-cream-100 p-3"
                style={{ borderColor: "rgba(67,55,39,0.10)" }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink-900">
                    {inv.email}
                  </div>
                  <div className="text-[11.5px] text-ink-500">
                    {inv.role} · expires {formatTimeUntil(inv.expires_at)}
                  </div>
                </div>
                <button
                  onClick={() => revoke(inv.id)}
                  disabled={revoking === inv.id}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 hover:bg-cream-200 disabled:opacity-60"
                  title="Revoke invite"
                >
                  {revoking === inv.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <X size={12} />
                  )}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
