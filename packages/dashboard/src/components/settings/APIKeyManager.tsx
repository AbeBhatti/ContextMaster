import { useState } from "react";
import { Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { useApiKeys } from "../../hooks/useApiKeys";
import type { CreatedApiKey } from "../../lib/types";
import { formatRelativeTime } from "../../lib/constants";
import { ErrorState } from "../common/ErrorState";
import { track } from "../../lib/analytics";

export function APIKeyManager() {
  const { data, loading, error, refetch, setData } = useApiKeys();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setCreateError(null);
    try {
      const key = await api.auth.createApiKey(name.trim());
      track("settings.api_key_generated");
      setRevealedKey(key);
      setName("");
      setCreating(false);
      refetch();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const revoke = async (id: string) => {
    setRevoking(id);
    setRevokeError(null);
    try {
      await api.auth.revokeApiKey(id);
      if (data) setData(data.filter((k) => k.id !== id));
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevoking(null);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };

  const activeKeys = (data ?? []).filter((k) => !k.revoked_at);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[14px] font-semibold text-ink-800">API keys</div>
          <div className="text-[12px] text-ink-500">
            Use these to connect MCP clients and other tools.
          </div>
        </div>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-md bg-ink-800 px-3 py-1.5 text-[12.5px] font-medium text-cream-50"
          >
            <Plus size={12} /> New key
          </button>
        )}
      </div>

      {revealedKey && (
        <div
          className="rounded-[9px] border p-3"
          style={{
            background: "rgba(95,165,122,.08)",
            borderColor: "rgba(95,165,122,.4)",
          }}
        >
          <div className="text-[12.5px] font-semibold text-[#2f6b48]">
            Key generated — copy it now. You won't see it again.
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded-md bg-white p-2 font-mono text-[12px] text-ink-900">
              {revealedKey.key}
            </code>
            <button
              onClick={() => copy(revealedKey.key)}
              className="flex h-8 items-center gap-1.5 rounded-md border bg-white px-2.5 text-[12px] font-medium text-ink-800"
              style={{ borderColor: "rgba(67,55,39,0.18)" }}
            >
              <Copy size={12} /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button
            onClick={() => setRevealedKey(null)}
            className="mt-2 text-[12px] text-ink-600 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {creating && (
        <form
          onSubmit={create}
          className="flex flex-col gap-2 rounded-[9px] border bg-white p-3"
          style={{ borderColor: "rgba(67,55,39,0.10)" }}
        >
          <input
            autoFocus
            placeholder="Key name (e.g. Claude Code on laptop)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border bg-cream-50 px-2.5 py-1.5 text-[13px] text-ink-800 outline-none placeholder:text-ink-500"
            style={{ borderColor: "rgba(67,55,39,0.18)" }}
          />
          {createError && (
            <div className="text-[12px] text-[#b04545]">{createError}</div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setName("");
                setCreateError(null);
              }}
              className="rounded-md border px-2.5 py-1 text-[12px] text-ink-700"
              style={{ borderColor: "rgba(67,55,39,0.18)" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="flex items-center gap-1.5 rounded-md bg-ink-800 px-3 py-1 text-[12.5px] font-medium text-cream-50 disabled:opacity-50"
            >
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Generate
            </button>
          </div>
        </form>
      )}

      {loading && (
        <div className="text-[12.5px] text-ink-500">Loading keys…</div>
      )}
      {error && !loading && <ErrorState message={error} onRetry={refetch} />}

      {revokeError && (
        <div className="text-[12px] text-[#b04545]">{revokeError}</div>
      )}

      {!loading && !error && activeKeys.length === 0 && (
        <div className="rounded-[9px] bg-cream-100 p-4 text-center text-[12.5px] text-ink-500">
          No active API keys yet.
        </div>
      )}

      {!loading && !error && activeKeys.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {activeKeys.map((k) => (
            <div
              key={k.id}
              className="flex items-center gap-3 rounded-[9px] border bg-white p-3"
              style={{ borderColor: "rgba(67,55,39,0.10)" }}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink-900">
                  {k.name ?? "Unnamed key"}
                </div>
                <div className="font-mono text-[11.5px] text-ink-500">
                  {k.key_prefix}…
                </div>
                <div className="mt-0.5 text-[11px] text-ink-400">
                  Created {formatRelativeTime(k.created_at)}
                  {k.last_used_at &&
                    ` · last used ${formatRelativeTime(k.last_used_at)}`}
                </div>
              </div>
              <button
                onClick={() => revoke(k.id)}
                disabled={revoking === k.id}
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 hover:bg-cream-200 disabled:opacity-60"
                title="Revoke"
              >
                {revoking === k.id ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Trash2 size={12} />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
