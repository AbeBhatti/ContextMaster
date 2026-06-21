import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { KbType, KnowledgeBase } from "../../lib/types";
import { KB_TYPE_OPTIONS, colorsFor } from "../../lib/constants";
import { templateFor } from "../../lib/kbTemplates";
import { api } from "../../lib/api";

interface CreateKbModalProps {
  workspaceId: string;
  onClose: () => void;
  onCreated: (kb: KnowledgeBase) => void;
}

export function CreateKbModal({
  workspaceId,
  onClose,
  onCreated,
}: CreateKbModalProps) {
  const [name, setName] = useState("");
  const [kbType, setKbType] = useState<string>("general");
  const [description, setDescription] = useState(
    templateFor("general").description
  );
  const [descriptionTouched, setDescriptionTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Pre-fill description when type changes — unless the user has edited it.
  useEffect(() => {
    if (descriptionTouched) return;
    setDescription(templateFor(kbType).description);
  }, [kbType, descriptionTouched]);

  const tc = useMemo(() => colorsFor(kbType), [kbType]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const kb = await api.knowledgeBases.create(workspaceId, {
        name: name.trim(),
        kb_type: kbType,
        description: description.trim() || undefined,
      });
      onCreated(kb);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(24,24,27,.32)", backdropFilter: "blur(2px)" }}
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[460px] rounded-2xl bg-cream-50 shadow-2xl"
        style={{ border: "0.5px solid rgba(24,24,27,0.15)" }}
      >
        <div
          className="flex items-center justify-between px-6 pb-4 pt-5"
          style={{ borderBottom: "0.5px solid rgba(24,24,27,0.10)" }}
        >
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-400">
              New
            </div>
            <h2 className="m-0 text-[19px] font-semibold tracking-tight text-ink-900">
              Knowledge base
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 hover:bg-cream-200"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-6 py-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Name
            </span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='e.g. "Project Financials" or "GTM Strategy"'
              className="rounded-lg border border-[rgba(24,24,27,0.18)] bg-white px-3 py-2.5 text-[15px] font-medium text-ink-900 outline-none placeholder:text-ink-400 placeholder:font-normal focus:border-[rgba(24,24,27,0.4)]"
              required
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Type
            </span>
            <div className="grid grid-cols-5 gap-1.5">
              {KB_TYPE_OPTIONS.map((opt) => {
                const c = colorsFor(opt.value);
                const active = opt.value === kbType;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setKbType(opt.value as KbType)}
                    className="flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[11.5px] font-medium transition-colors"
                    style={{
                      background: active ? c.tint : "transparent",
                      color: active ? c.text : "#6b7280",
                      border: active
                        ? `1px solid ${c.dot}`
                        : "1px solid rgba(24,24,27,0.12)",
                    }}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: c.dot }}
                    />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Description
            </span>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setDescriptionTouched(true);
              }}
              rows={4}
              className="resize-none rounded-lg border border-[rgba(24,24,27,0.18)] bg-white px-3 py-2.5 text-[13px] leading-snug text-ink-800 outline-none placeholder:text-ink-400 focus:border-[rgba(24,24,27,0.4)]"
              placeholder={templateFor(kbType).description}
            />
            <span className="text-[11px] text-ink-500">
              Helps the AI match future conversations against this knowledge
              base. Edit to fit the specific purpose.
            </span>
          </label>

          {error && (
            <div className="text-[12px] text-danger">{error}</div>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2 px-6 py-3.5"
          style={{ borderTop: "0.5px solid rgba(24,24,27,0.10)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[rgba(24,24,27,0.18)] bg-white px-3.5 py-1.5 text-[13px] font-medium text-ink-700 hover:bg-cream-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || submitting}
            className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold text-cream-50 disabled:opacity-50"
            style={{ background: tc.text }}
          >
            {submitting && <Loader2 size={13} className="animate-spin" />}
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
