import { useHistory } from "../../hooks/useHistory";
import { avatarColor, initialOf } from "../../lib/constants";

interface ContributorSummaryProps {
  workspaceId: string;
  kbId: string;
}

/**
 * Show a compact "Contributed by" pill at the top of a KB detail panel.
 * Derives the contributor list from sessions on this KB so we don't need a
 * dedicated endpoint and stay consistent with what the History tab shows.
 */
export function ContributorSummary({
  workspaceId,
  kbId,
}: ContributorSummaryProps) {
  const { data, loading } = useHistory(workspaceId, {
    knowledge_base_id: kbId,
    limit: 200,
  });

  if (loading || !data || data.length === 0) return null;

  // Aggregate by user_id, count sessions, keep most-recent first.
  const byUser = new Map<
    string,
    { id: string; name: string; sessions: number }
  >();
  for (const s of data) {
    const existing = byUser.get(s.user.id);
    if (existing) {
      existing.sessions += 1;
    } else {
      byUser.set(s.user.id, {
        id: s.user.id,
        name: s.user.name,
        sessions: 1,
      });
    }
  }
  const contributors = Array.from(byUser.values()).sort(
    (a, b) => b.sessions - a.sessions
  );
  if (contributors.length === 0) return null;

  const visible = contributors.slice(0, 3);
  const overflow = contributors.length - visible.length;
  const names = contributors
    .slice(0, 3)
    .map((c) => c.name.split(" ")[0])
    .join(", ");

  return (
    <div className="mt-3.5 flex items-center gap-2">
      <div className="flex">
        {visible.map((c, i) => (
          <span
            key={c.id}
            className="flex h-6 w-6 items-center justify-center rounded-full text-[9.5px] font-bold text-cream-50"
            style={{
              background: avatarColor(c.id),
              border: "2px solid #ffffff",
              marginLeft: i === 0 ? 0 : -8,
            }}
            title={`${c.name} · ${c.sessions} ${
              c.sessions === 1 ? "session" : "sessions"
            }`}
          >
            {initialOf(c.name)}
          </span>
        ))}
        {overflow > 0 && (
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full bg-cream-500 text-[9.5px] font-bold text-ink-700"
            style={{ border: "2px solid #ffffff", marginLeft: -8 }}
          >
            +{overflow}
          </span>
        )}
      </div>
      <div className="text-[11.5px] text-ink-500">
        {contributors.length === 1
          ? `Contributed by ${contributors[0].name}`
          : `${contributors.length} contributors${
              overflow === 0 ? `: ${names}` : `: ${names} +${overflow}`
            }`}
      </div>
    </div>
  );
}
