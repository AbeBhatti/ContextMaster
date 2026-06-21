import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useChunks } from "../../hooks/useChunks";
import { CHUNK_GROUPS, groupForChunkType } from "../../lib/constants";
import type { Chunk } from "../../lib/types";
import { ChunkListSkeleton } from "../common/LoadingSkeleton";
import { ErrorState } from "../common/ErrorState";
import { ChunkCard } from "./ChunkCard";

interface ChunkListProps {
  workspaceId: string;
  kbId: string;
  isViewer?: boolean;
}

export function ChunkList({ workspaceId, kbId, isViewer = false }: ChunkListProps) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({
    decisions: true,
    state: false,
    conventions: false,
    findings: false,
    questions: false,
    references: false,
  });

  const { data, loading, error, refetch, setData } = useChunks(
    workspaceId,
    kbId,
    { limit: 200, status: "active", search: search || undefined }
  );

  const grouped = useMemo(() => {
    const buckets: Record<string, Chunk[]> = {};
    CHUNK_GROUPS.forEach((g) => {
      buckets[g.id] = [];
    });
    if (data) {
      for (const c of data.chunks) {
        const group = groupForChunkType(c.chunk_type);
        buckets[group.id].push(c);
      }
    }
    return buckets;
  }, [data]);

  // Lookup for resolving related_chunk_ids → a short content preview that
  // ChunkCard can render as a "Related to" line for context chunks.
  const chunkById = useMemo(() => {
    const map = new Map<string, Chunk>();
    if (data) {
      for (const c of data.chunks) map.set(c.id, c);
    }
    return map;
  }, [data]);

  return (
    <>
      <div className="relative mb-3.5">
        <input
          placeholder="Search knowledge…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border bg-cream-300 py-2.5 pl-9 pr-3 text-[13px] text-ink-900 outline-none placeholder:text-ink-500 focus:bg-cream-100"
          style={{ borderColor: "rgba(67,55,39,0.12)" }}
        />
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
        />
      </div>

      {loading && <ChunkListSkeleton />}
      {error && !loading && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && data && (
        <div className="flex flex-col gap-1.5">
          {CHUNK_GROUPS.map((g) => {
            const items = grouped[g.id];
            const total = items.length;
            const isOpen = open[g.id];
            return (
              <div
                key={g.id}
                className="border-b"
                style={{ borderColor: "rgba(67,55,39,0.08)" }}
              >
                <button
                  onClick={() => setOpen({ ...open, [g.id]: !isOpen })}
                  className="flex w-full items-center gap-2.5 bg-transparent px-1 py-3 text-left"
                >
                  <span
                    className="flex h-[22px] w-[22px] items-center justify-center rounded-md text-[11px] font-bold"
                    style={{ background: g.accent + "22", color: g.accent }}
                  >
                    {g.icon}
                  </span>
                  <span className="flex-1 text-[13.5px] font-semibold text-ink-800">
                    {g.label}
                  </span>
                  <span className="text-[12px] tabular-nums text-ink-500">
                    {total}
                  </span>
                  <span
                    className="inline-block w-3 text-[11px] text-ink-400 transition-transform"
                    style={{
                      transform: isOpen ? "rotate(90deg)" : "rotate(0)",
                    }}
                  >
                    ›
                  </span>
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-2 px-1 pb-3.5">
                    {total === 0 ? (
                      <div className="rounded-lg bg-cream-100 p-4 text-center text-[12.5px] text-ink-400">
                        {search
                          ? "No matches in this group."
                          : `Nothing here yet — start a conversation to add ${g.label.toLowerCase()}.`}
                      </div>
                    ) : (
                      items.map((c) => (
                        <ChunkCard
                          key={c.id}
                          chunk={c}
                          accentColor={g.accent}
                          readOnly={isViewer}
                          relatedChunks={(c.related_chunk_ids ?? [])
                            .map((id) => chunkById.get(id))
                            .filter((x): x is Chunk => Boolean(x))}
                          onUpdated={(updated) => {
                            if (!data) return;
                            setData({
                              ...data,
                              chunks: data.chunks.map((x) =>
                                x.id === updated.id ? updated : x
                              ),
                            });
                          }}
                          onDeleted={(id) => {
                            if (!data) return;
                            setData({
                              ...data,
                              chunks: data.chunks.filter((x) => x.id !== id),
                              total: Math.max(0, data.total - 1),
                            });
                          }}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
