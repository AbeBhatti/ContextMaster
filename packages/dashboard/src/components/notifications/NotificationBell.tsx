import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { useNotifications } from "../../hooks/useNotifications";
import { avatarColor, formatRelativeTime, initialOf } from "../../lib/constants";
import type { Notification } from "../../lib/types";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const {
    unreadCount,
    notifications,
    loading,
    loadList,
    markAllRead,
    markRead,
  } = useNotifications();

  // Refresh the list whenever the panel opens.
  useEffect(() => {
    if (open) void loadList();
  }, [open, loadList]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const onClickItem = async (n: Notification) => {
    if (!n.read_at) await markRead([n.id]);
    if (n.workspace_id) {
      navigate(`/workspace/${n.workspace_id}`);
    }
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-ink-700 hover:bg-cream-200"
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9.5px] font-bold text-cream-50"
            style={{ background: "#dc2626" }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-[110%] z-30 w-[360px] rounded-[10px] border bg-cream-50 shadow-lg"
          style={{
            borderColor: "rgba(24,24,27,0.14)",
            boxShadow: "0 12px 30px rgba(24,24,27,.18)",
          }}
        >
          <div
            className="flex items-center justify-between px-3 py-2"
            style={{ borderBottom: "0.5px solid rgba(24,24,27,0.10)" }}
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
              Notifications
            </div>
            {notifications.some((n) => !n.read_at) && (
              <button
                onClick={() => void markAllRead()}
                className="text-[11.5px] font-medium text-ink-700 hover:text-ink-900"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {loading && (
              <div className="px-3 py-6 text-center text-[12.5px] text-ink-500">
                Loading…
              </div>
            )}
            {!loading && notifications.length === 0 && (
              <div className="px-3 py-6 text-center text-[12.5px] text-ink-500">
                You're all caught up.
              </div>
            )}
            {!loading && notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => void onClickItem(n)}
                className="flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left hover:bg-cream-100"
                style={{
                  borderColor: "rgba(24,24,27,0.06)",
                  background: n.read_at ? "transparent" : "rgba(61,90,128,.08)",
                }}
              >
                {n.actor ? (
                  <span
                    className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold text-cream-50"
                    style={{ background: avatarColor(n.actor.id) }}
                  >
                    {initialOf(n.actor.name)}
                  </span>
                ) : (
                  <span
                    className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold text-cream-50"
                    style={{ background: "#71717a" }}
                  >
                    ?
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] leading-snug text-ink-900">
                    {n.title}
                  </div>
                  {n.body && (
                    <div className="mt-0.5 line-clamp-2 text-[11.5px] text-ink-600">
                      {n.body}
                    </div>
                  )}
                  <div className="mt-1 text-[10.5px] text-ink-400">
                    {n.workspace_name && (
                      <>
                        {n.workspace_name}
                        {" · "}
                      </>
                    )}
                    {formatRelativeTime(n.created_at)}
                  </div>
                </div>
                {!n.read_at && (
                  <span
                    className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{ background: "#3d5a80" }}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
