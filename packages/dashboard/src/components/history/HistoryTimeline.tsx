import { Loader2 } from "lucide-react";
import type { ProcessingJobSummary, SessionEntry } from "../../lib/types";
import {
  avatarColor,
  formatRelativeTime,
  initialOf,
  toolMeta,
} from "../../lib/constants";

interface HistoryTimelineProps {
  sessions: SessionEntry[];
  // Optional — KBPanel and other KB-scoped views render without jobs.
  // When supplied, in-flight jobs (queued / processing / failed) render at
  // the top of the timeline as their own entries with a subtle indicator.
  // The graph is the primary surface for processing state; the timeline
  // entry is just a quiet log line so the activity isn't invisible.
  jobs?: ProcessingJobSummary[];
}

export function HistoryTimeline({ sessions, jobs }: HistoryTimelineProps) {
  // Skip completed jobs — those are already represented by the session row
  // they produced. Only show queued / processing / failed.
  const inflightJobs = (jobs ?? []).filter((j) => j.status !== "completed");

  if (sessions.length === 0 && inflightJobs.length === 0) {
    return (
      <div className="px-3 py-10 text-center text-[13px] text-ink-400">
        No activity yet — sessions committed by your AI tools will appear here.
      </div>
    );
  }

  return (
    <div className="relative pl-5">
      <div
        className="absolute bottom-1 left-1.5 top-1 w-px"
        style={{ background: "rgba(24,24,27,0.14)" }}
      />

      {inflightJobs.map((j) => {
        const tool = toolMeta(j.tool_used);
        const dotColor = j.status === "failed" ? "#dc2626" : "#3d5a80";
        return (
          <div key={`job-${j.id}`} className="relative pb-5">
            <span
              className="absolute -left-4 top-1 h-2.5 w-2.5 rounded-full"
              style={{ background: "#ffffff", border: `2px solid ${dotColor}` }}
            />
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-700">
              {j.tool_used && (
                <span
                  className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium text-cream-50"
                  style={{ background: tool.tint }}
                  title={tool.label}
                >
                  <span className="text-[10px]">{tool.icon}</span>
                  {tool.label}
                </span>
              )}
              <span className="text-ink-500">
                {formatRelativeTime(j.created_at)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[13px] text-ink-700">
              {j.status === "failed" ? (
                <span className="text-danger">Processing failed</span>
              ) : (
                <>
                  <Loader2 size={12} className="animate-spin text-ink-400" />
                  <span>Processing…</span>
                </>
              )}
              {j.knowledge_base_name && (
                <span className="text-ink-500">· {j.knowledge_base_name}</span>
              )}
            </div>
          </div>
        );
      })}

      {sessions.map((s) => {
        const tool = toolMeta(s.tool_used);
        return (
          <div key={`session-${s.id}`} className="relative pb-5">
            <span
              className="absolute -left-4 top-1 h-2.5 w-2.5 rounded-full"
              style={{ background: "#ffffff", border: "2px solid #3d5a80" }}
            />
            <div className="flex items-center gap-2 text-[12.5px] text-ink-700">
              <span
                className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-cream-50"
                style={{ background: avatarColor(s.user.id) }}
                title={s.user.name}
              >
                {initialOf(s.user.name)}
              </span>
              <b className="font-semibold text-ink-900">{s.user.name}</b>
              {s.tool_used && (
                <>
                  <span className="text-ink-300">·</span>
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium text-cream-50"
                    style={{ background: tool.tint }}
                    title={tool.label}
                  >
                    <span className="text-[10px]">{tool.icon}</span>
                    {tool.label}
                  </span>
                </>
              )}
              <span className="text-ink-300">·</span>
              <span className="text-ink-500">
                {formatRelativeTime(s.timestamp)}
              </span>
            </div>
            {s.summary && (
              <div className="mt-1 text-[13px] text-ink-900">{s.summary}</div>
            )}
            <div className="mt-1 text-[11.5px] text-ink-500">
              +{s.chunks_added} added
              {s.chunks_superseded > 0
                ? `, ${s.chunks_superseded} superseded`
                : ""}
              {s.knowledge_bases.length > 0 && (
                <>
                  {" · "}
                  {s.knowledge_bases.map((kb, i) => (
                    <span key={kb.id}>
                      {i > 0 && ", "}
                      <span className="text-ink-700">{kb.name}</span>
                    </span>
                  ))}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
