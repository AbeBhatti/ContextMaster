import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Notification } from "../lib/types";

const POLL_INTERVAL_MS = 45_000;

export interface NotificationsState {
  unreadCount: number;
  loading: boolean;
  notifications: Notification[];
  refresh: () => void;
  loadList: () => Promise<void>;
  markAllRead: () => Promise<void>;
  markRead: (ids: string[]) => Promise<void>;
}

/**
 * Polls /api/notifications/unread-count on a 45s interval to drive the bell
 * badge. Loads the full list on demand (when the dropdown opens) instead of
 * over-fetching it.
 */
export function useNotifications(): NotificationsState {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const aliveRef = useRef(true);

  const refreshUnread = useCallback(async () => {
    try {
      const n = await api.notifications.unreadCount();
      if (aliveRef.current) setUnreadCount(n);
    } catch {
      // fail silently — the badge is best-effort
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.notifications.list({ limit: 30 });
      if (aliveRef.current) setNotifications(r.notifications);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  const markRead = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      await api.notifications.markRead({ ids });
      setNotifications((cur) =>
        cur.map((n) =>
          ids.includes(n.id) && !n.read_at
            ? { ...n, read_at: new Date().toISOString() }
            : n
        )
      );
      await refreshUnread();
    },
    [refreshUnread]
  );

  const markAllRead = useCallback(async () => {
    await api.notifications.markRead({ all: true });
    const now = new Date().toISOString();
    setNotifications((cur) =>
      cur.map((n) => (n.read_at ? n : { ...n, read_at: now }))
    );
    setUnreadCount(0);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void refreshUnread();
    const id = setInterval(refreshUnread, POLL_INTERVAL_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, [refreshUnread]);

  return {
    unreadCount,
    loading,
    notifications,
    refresh: refreshUnread,
    loadList,
    markAllRead,
    markRead,
  };
}
