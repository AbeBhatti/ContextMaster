import type { KnowledgeBase } from "../../lib/types";
import { colorsFor, formatRelativeTime } from "../../lib/constants";

interface ListViewProps {
  knowledgeBases: KnowledgeBase[];
  onSelect: (kbId: string) => void;
}

export function ListView({ knowledgeBases, onSelect }: ListViewProps) {
  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 pt-5">
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
      >
        {knowledgeBases.map((kb) => {
          const tc = colorsFor(kb.kb_type);
          return (
            <button
              key={kb.id}
              onClick={() => onSelect(kb.id)}
              className="flex flex-col gap-2 rounded-xl border bg-cream-50 p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
              style={{ borderColor: "rgba(67,55,39,0.12)" }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: tc.dot }}
                />
                <span
                  className="text-[11px] font-semibold capitalize tracking-wider"
                  style={{ color: tc.text }}
                >
                  {kb.kb_type}
                </span>
                {kb.is_shared && (
                  <span
                    className="rounded-full px-1.5 py-0 text-[10.5px] text-ink-600"
                    style={{ border: "1px dashed rgba(67,55,39,0.25)" }}
                  >
                    Shared
                  </span>
                )}
                {kb.is_system && (
                  <span
                    className="rounded-full px-1.5 py-0 text-[10.5px] text-ink-600"
                    style={{ border: "1px dashed rgba(67,55,39,0.25)" }}
                    title="Built-in Context Cloud knowledge base"
                  >
                    System
                  </span>
                )}
              </div>
              <div className="text-base font-semibold leading-tight text-ink-900">
                {kb.name}
              </div>
              {(kb.summary ?? kb.description) && (
                <div
                  className="line-clamp-2 text-[12.5px] leading-snug text-ink-600"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical" as const,
                    overflow: "hidden",
                  }}
                >
                  {kb.summary ?? kb.description}
                </div>
              )}
              <div className="mt-auto flex gap-2.5 text-[11.5px] text-ink-400">
                <span>
                  {kb.chunk_count} {kb.chunk_count === 1 ? "item" : "items"}
                </span>
                <span>·</span>
                <span>Updated {formatRelativeTime(kb.updated_at)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
