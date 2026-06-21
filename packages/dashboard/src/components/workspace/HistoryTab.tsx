import { useMemo, useState } from "react";
import { useHistory } from "../../hooks/useHistory";
import { useJobs } from "../../hooks/useJobs";
import type { KnowledgeBase, WorkspaceMember } from "../../lib/types";
import { HistoryTimeline } from "../history/HistoryTimeline";
import { ErrorState } from "../common/ErrorState";
import { Skeleton } from "../common/LoadingSkeleton";
import { EmptyState } from "../common/EmptyState";

interface HistoryTabProps {
  workspaceId: string;
  knowledgeBases: KnowledgeBase[];
  members: WorkspaceMember[];
}

export function HistoryTab({
  workspaceId,
  knowledgeBases,
  members,
}: HistoryTabProps) {
  const [userFilter, setUserFilter] = useState<string>("");
  const [kbFilter, setKbFilter] = useState<string>("");

  const filters = useMemo(
    () => ({
      user_id: userFilter || undefined,
      knowledge_base_id: kbFilter || undefined,
      limit: 100,
    }),
    [userFilter, kbFilter]
  );

  const { data, loading, error, refetch } = useHistory(workspaceId, filters);

  // Surface in-flight + failed jobs as quiet timeline entries. The graph is
  // the primary processing-state surface; here we just keep the activity log
  // honest. useJobs polls every 5s while jobs are in-flight.
  const jobsState = useJobs(workspaceId, { limit: 20 });

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 pt-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className="rounded-md border bg-cream-50 px-2.5 py-1.5 text-[12.5px] text-ink-800 outline-none"
          style={{ borderColor: "rgba(24,24,27,0.18)" }}
        >
          <option value="">All members</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.name}
            </option>
          ))}
        </select>
        <select
          value={kbFilter}
          onChange={(e) => setKbFilter(e.target.value)}
          className="rounded-md border bg-cream-50 px-2.5 py-1.5 text-[12.5px] text-ink-800 outline-none"
          style={{ borderColor: "rgba(24,24,27,0.18)" }}
        >
          <option value="">All knowledge bases</option>
          {knowledgeBases.map((kb) => (
            <option key={kb.id} value={kb.id}>
              {kb.name}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}
      {error && !loading && <ErrorState message={error} onRetry={refetch} />}
      {!loading &&
        !error &&
        (data ?? []).length === 0 &&
        (jobsState.data?.jobs ?? []).length === 0 && (
          <EmptyState
            title="No activity yet"
            body="Sessions committed by your AI tools will appear here."
          />
        )}
      {!loading && !error && (
        <HistoryTimeline
          sessions={data ?? []}
          jobs={jobsState.data?.jobs ?? []}
        />
      )}
    </div>
  );
}
