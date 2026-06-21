import { Router, type Request, type Response } from "express";
import { getRedis } from "../lib/redis.js";
import {
  listNotifications,
  unreadCount,
  markRead,
} from "../lib/notificationRepo.js";
import { getUsersByIds } from "../lib/userRepo.js";
import { getWorkspace } from "../lib/workspaceRepo.js";

// Redis port of the reference's routes/notifications.ts. Same dashboard shape
// (list + unread-count + mark-read), backed by notificationRepo (per-user
// sorted set) instead of the Supabase `notifications` table. Actor + workspace
// names are joined in-app, replacing the PostgREST embedded selects.

export const notificationsRouter = Router();

// GET /api/notifications
notificationsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const redis = getRedis();
    const userId = req.user!.id;
    const limit = Math.min(parseInt((req.query.limit as string) ?? "30", 10), 100);
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    const onlyUnread = req.query.unread === "true";

    const { notifications, total } = await listNotifications(redis, userId, {
      limit,
      offset,
      onlyUnread,
    });

    // Join actor + workspace names in-app.
    const actorIds = Array.from(
      new Set(notifications.map((n) => n.actor_id).filter(Boolean) as string[])
    );
    const actors = await getUsersByIds(redis, actorIds);
    const wsNameCache = new Map<string, string | null>();
    for (const n of notifications) {
      if (n.workspace_id && !wsNameCache.has(n.workspace_id)) {
        const ws = await getWorkspace(redis, n.workspace_id);
        wsNameCache.set(n.workspace_id, ws?.name ?? null);
      }
    }

    res.json({
      notifications: notifications.map((n) => {
        const actor = n.actor_id ? actors.get(n.actor_id) : null;
        return {
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          workspace_id: n.workspace_id,
          workspace_name: n.workspace_id ? wsNameCache.get(n.workspace_id) ?? null : null,
          actor: actor
            ? { id: actor.id, name: actor.name ?? actor.email ?? "Unknown", email: actor.email }
            : null,
          read_at: n.read_at,
          created_at: n.created_at,
        };
      }),
      total,
      offset,
      limit,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to list notifications" });
  }
});

// GET /api/notifications/unread-count — for the bell badge
notificationsRouter.get("/unread-count", async (req: Request, res: Response) => {
  try {
    const unread = await unreadCount(getRedis(), req.user!.id);
    res.json({ unread });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to count notifications" });
  }
});

// POST /api/notifications/read — Body: { ids: [...] } or { all: true }
notificationsRouter.post("/read", async (req: Request, res: Response) => {
  try {
    const redis = getRedis();
    const userId = req.user!.id;
    const { ids, all } = req.body as { ids?: string[]; all?: boolean };

    if (all) {
      await markRead(redis, userId, { all: true });
      res.json({ success: true });
      return;
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "Provide ids: [...] or all: true" });
      return;
    }
    await markRead(redis, userId, { ids });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to mark notifications read" });
  }
});
