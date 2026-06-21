import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../../lib/api";
import type { Invite } from "../../lib/types";

interface InviteFormProps {
  workspaceId: string;
  onInvited: (invite: Invite) => void;
}

export function InviteForm({ workspaceId, onInvited }: InviteFormProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(email) || submitting) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const invite = await api.team.invite(workspaceId, email.trim(), role);
      onInvited(invite);
      setSuccess(`Invite sent to ${email}`);
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 rounded-[9px] border bg-white p-4"
      style={{ borderColor: "rgba(67,55,39,0.10)" }}
    >
      <div className="text-[13px] font-semibold text-ink-800">
        Invite by email
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          required
          placeholder="teammate@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 rounded-md border bg-cream-50 px-2.5 py-1.5 text-[13px] text-ink-800 outline-none placeholder:text-ink-500"
          style={{ borderColor: "rgba(67,55,39,0.18)" }}
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="rounded-md border bg-cream-50 px-2 py-1.5 text-[13px] text-ink-800 outline-none"
          style={{ borderColor: "rgba(67,55,39,0.18)" }}
        >
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
        <button
          type="submit"
          disabled={!isValidEmail(email) || submitting}
          className="flex items-center gap-1.5 rounded-md bg-ink-800 px-3 py-1.5 text-[13px] font-medium text-cream-50 disabled:opacity-50"
        >
          {submitting && <Loader2 size={12} className="animate-spin" />}
          Send invite
        </button>
      </div>
      {error && <div className="text-[12px] text-[#b04545]">{error}</div>}
      {success && (
        <div className="text-[12px] text-[#2f6b48]">{success}</div>
      )}
    </form>
  );
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}
