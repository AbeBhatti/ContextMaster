import { useEffect, useMemo, useRef } from "react";
import { api } from "../lib/api";
import { useFetch } from "./useFetch";
import { usePolling } from "./usePolling";
import { emit } from "../lib/eventBus";
import type { JobsListResponse, JobStatus } from "../lib/types";

// Aggressive poll while there's an in-flight job. The ProcessingRing on the
// graph hangs off this signal — any longer and the ring lingers visibly past
// when the job actually finished.
const POLL_INTERVAL_INFLIGHT_MS = 3000;
// Relaxed background poll otherwise. Catches commits that arrive from other
// MCP tools while the dashboard is open without burning request budget.
const POLL_INTERVAL_IDLE_MS = 60000;

export interface ProcessingKbsState {
  // kb_id → status. 'processing' wins over 'queued' if the same KB has
  // multiple in-flight jobs.
  byKb: Map<string, JobStatus>;
  isLoading: boolean;
  error: string | null;
}

/**
 * Lightweight hook for the knowledge graph: returns the set of KB ids that
 * currently have an in-flight server-side extraction job, along with each
 * one's status so the ring can differentiate queued (slow pulse) vs
 * processing (fast spin).
 *
 * Polls every 3s while in-flight, drops to a 60s "freshness" cadence when
 * idle. When a job transitions from processing → completed/failed, emits
 * 'job-completed' and 'kb-updated' so dependent hooks (graph, history,
 * workspace stats) can refetch in the same tick instead of waiting on their
 * own polling cycle.
 */
export function useProcessingKbs(
  workspaceId: string | null | undefined
): ProcessingKbsState {
  const processing = useFetch<JobsListResponse>(
    (signal) => {
      if (!workspaceId)
        return Promise.reject(new Error("missing workspace id"));
      return api.jobs.list(
        workspaceId,
        { status: "processing", limit: 50 },
        signal
      );
    },
    [workspaceId]
  );

  const queued = useFetch<JobsListResponse>(
    (signal) => {
      if (!workspaceId)
        return Promise.reject(new Error("missing workspace id"));
      return api.jobs.list(
        workspaceId,
        { status: "queued", limit: 50 },
        signal
      );
    },
    [workspaceId]
  );

  const byKb = useMemo(() => {
    const m = new Map<string, JobStatus>();
    for (const j of queued.data?.jobs ?? []) m.set(j.knowledge_base_id, "queued");
    for (const j of processing.data?.jobs ?? [])
      m.set(j.knowledge_base_id, "processing"); // overrides queued
    return m;
  }, [queued.data?.jobs, processing.data?.jobs]);

  // Detect transitions. We snapshot the previous set of in-flight job IDs
  // (mapped to their KB) and compare to the current poll. Any job that was
  // in-flight last tick but isn't now must have finished — fire 'job-
  // completed' so the graph, history, and workspace stats refetch in the
  // same tick instead of each waiting on their own polling cadence.
  type InflightSnap = { jobId: string; kbId: string };
  const lastInflightRef = useRef<Map<string, InflightSnap>>(new Map());
  useEffect(() => {
    const current = new Map<string, InflightSnap>();
    for (const j of processing.data?.jobs ?? [])
      current.set(j.id, { jobId: j.id, kbId: j.knowledge_base_id });
    for (const j of queued.data?.jobs ?? []) {
      if (!current.has(j.id))
        current.set(j.id, { jobId: j.id, kbId: j.knowledge_base_id });
    }

    const previous = lastInflightRef.current;
    // Only fire transitions once we've seen at least one poll. On first
    // mount `previous` is empty, so the diff would mark every job as
    // "completed" and spam events — skip that.
    if (previous.size > 0) {
      for (const [jobId, snap] of previous) {
        if (!current.has(jobId)) {
          emit({
            type: "job-completed",
            knowledgeBaseId: snap.kbId,
            workspaceId: workspaceId ?? undefined,
          });
          emit({
            type: "kb-updated",
            knowledgeBaseId: snap.kbId,
            workspaceId: workspaceId ?? undefined,
          });
        }
      }
    }
    lastInflightRef.current = current;
  }, [processing.data?.jobs, queued.data?.jobs, workspaceId]);

  // Poll cadence: aggressive while in-flight, relaxed otherwise.
  // Page Visibility handling lives in usePolling — when the tab is hidden
  // we skip ticks, and we fire one immediate fetch when the tab returns.
  usePolling(
    () => {
      processing.refetch();
      queued.refetch();
    },
    {
      interval: byKb.size > 0 ? POLL_INTERVAL_INFLIGHT_MS : POLL_INTERVAL_IDLE_MS,
      enabled: !!workspaceId,
      refetchOnVisible: true,
    }
  );

  return {
    byKb,
    isLoading: processing.loading || queued.loading,
    error: processing.error ?? queued.error,
  };
}
