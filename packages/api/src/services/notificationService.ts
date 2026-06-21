import { getRedis } from "../lib/redis.js";
import { getWorkspace } from "../lib/workspaceRepo.js";
import { getWorkspaceMemberIds } from "../lib/workspaceRepo.js";
import { createNotifications } from "../lib/notificationRepo.js";

// Redis port of the reference's notificationService.ts. Same call site
// (`notify(input)`, fire-and-forget, never awaited) and recipient resolution
// (workspace owner + every member, minus the actor); only the data layer
// changed from the Postgres `notifications` table to Redis hashes + per-user
// sorted sets.

export type NotificationType =
  | "commit"
  | "document_upload"
  | "invite_accepted"
  | "invite_sent"
  | "member_joined"
  | "member_removed";

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body?: string | null;
  workspaceId: string;
  actorId: string;
  // If provided, send to exactly these users. Otherwise recipients are the
  // workspace owner + every workspace member, minus the actor.
  recipientIds?: string[];
}

async function resolveRecipients(workspaceId: string, actorId: string): Promise<string[]> {
  const redis = getRedis();
  const [ws, memberIds] = await Promise.all([
    getWorkspace(redis, workspaceId),
    getWorkspaceMemberIds(redis, workspaceId),
  ]);

  const ids = new Set<string>();
  if (ws?.owner_id) ids.add(ws.owner_id);
  for (const uid of memberIds) ids.add(uid);
  ids.delete(actorId);
  return Array.from(ids);
}

/**
 * Fire-and-forget notification creation. Never throws; logs errors instead.
 * Callers MUST NOT await this — it stays off the user-facing latency path.
 */
export function notify(input: NotificationInput): void {
  void (async () => {
    try {
      const redis = getRedis();
      const recipients =
        input.recipientIds ?? (await resolveRecipients(input.workspaceId, input.actorId));
      if (recipients.length === 0) return;

      await createNotifications(
        redis,
        recipients.map((userId) => ({
          user_id: userId,
          workspace_id: input.workspaceId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          actor_id: input.actorId,
        }))
      );
    } catch (err: any) {
      console.error("[notifications] error:", err?.message ?? err);
    }
  })();
}
