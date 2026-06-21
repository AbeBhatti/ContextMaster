// Lightweight module-level pub/sub for cross-hook refresh coordination.
//
// When one part of the dashboard learns that a server-side job finished, a
// new chunk landed, or a session was committed, it `emit()`s the event and
// every subscribed hook refetches in response. No React Context wrapper —
// the dashboard is a single SPA and a module singleton is sufficient, with
// the benefit that publishers don't need to thread a dispatcher through
// props.
//
// Event semantics are intentionally narrow:
//   kb-updated     — fired on any state change that affects KB stats (chunk
//                    count, last_updated, summary). Listeners that show KB
//                    facts refetch.
//   job-completed  — fired when a processing_jobs row transitions to a
//                    terminal state (completed/failed). Carries the kb_id;
//                    if the listener is scoped to a workspace it can use
//                    the kb_id to decide whether to refetch.
//   session-created — fired when a new session lands. History listeners
//                    refetch; KB listeners may also refetch since stats
//                    change.
//   focus           — fired on window focus or Page Visibility 'visible'.
//                    Wakes every listener regardless of which workspace.

export type DashboardEventType =
  | "kb-updated"
  | "job-completed"
  | "session-created"
  | "focus";

export interface DashboardEvent {
  type: DashboardEventType;
  knowledgeBaseId?: string;
  workspaceId?: string;
}

type Listener = (event: DashboardEvent) => void;

const listeners = new Map<DashboardEventType, Set<Listener>>();

export function subscribe(
  type: DashboardEventType,
  listener: Listener
): () => void {
  let set = listeners.get(type);
  if (!set) {
    set = new Set();
    listeners.set(type, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
  };
}

export function emit(event: DashboardEvent): void {
  const set = listeners.get(event.type);
  if (!set) return;
  // Snapshot before iterating in case a listener unsubscribes during dispatch.
  for (const fn of Array.from(set)) {
    try {
      fn(event);
    } catch (err) {
      // Don't let a single listener's bug break dispatch for the rest.
      console.error(`[event-bus] listener for ${event.type} threw:`, err);
    }
  }
}
