import { Router, Request, Response } from "express";
import express from "express";
import { Webhook } from "svix";
import { getRedis } from "../lib/redis.js";
import { k } from "../lib/keys.js";
import { getUserByClerkId, getUserByEmail, linkClerkId } from "../lib/userRepo.js";
import { upsertUserFromClerk } from "../lib/provisioning.js";
import { track, setUserProfile } from "../lib/analytics.js";

// Clerk webhook receiver. Keeps the Redis user layer in sync with Clerk's
// source of truth. Svix-signed, so it authenticates itself (no JWT/API key).
// Redis-backed port of the reference's clerkWebhook.ts.

export const clerkWebhookRouter = Router();

const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

interface ClerkEmailAddress {
  id: string;
  email_address: string;
}

interface ClerkUserData {
  id: string;
  email_addresses?: ClerkEmailAddress[];
  primary_email_address_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

interface ClerkWebhookEvent {
  type: string;
  data: ClerkUserData;
}

function primaryEmail(data: ClerkUserData): string | null {
  const list = data.email_addresses ?? [];
  if (list.length === 0) return null;
  if (data.primary_email_address_id) {
    const match = list.find((e) => e.id === data.primary_email_address_id);
    if (match) return match.email_address;
  }
  return list[0].email_address ?? null;
}

function fullName(data: ClerkUserData): string | null {
  const parts = [data.first_name, data.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

async function handleUserCreated(data: ClerkUserData): Promise<void> {
  const redis = getRedis();
  const clerkId = data.id;
  const email = primaryEmail(data);
  const name = fullName(data);

  if (!email) {
    console.warn(`[clerkWebhook] user.created ${clerkId} has no email; skipping`);
    return;
  }

  const existing = await getUserByClerkId(redis, clerkId);
  if (existing) {
    console.log(`[clerkWebhook] user.created ${clerkId} already exists; skipping`);
    return;
  }

  // upsertUserFromClerk handles email-linking and full provisioning (default
  // workspace + owner membership + Getting Started KB). It returns the user
  // whether it linked an existing row or created a fresh one.
  const before = await getUserByEmail(redis, email);
  const user = await upsertUserFromClerk(redis, { clerkId, email, name });

  if (before) {
    console.log(`[clerkWebhook] linked existing user ${user.id} to clerk_id ${clerkId}`);
    return;
  }

  track(user.id, "user.signup", { auth_provider: "clerk" });
  setUserProfile(user.id, {
    $created: new Date().toISOString(),
    plan: "free",
  });

  console.log(`[clerkWebhook] provisioned user ${user.id} (clerk ${clerkId})`);
}

async function handleUserUpdated(data: ClerkUserData): Promise<void> {
  const redis = getRedis();
  const clerkId = data.id;
  const email = primaryEmail(data);
  const name = fullName(data);

  const user = await getUserByClerkId(redis, clerkId);
  if (!user) {
    console.warn(`[clerkWebhook] user.updated ${clerkId} not found; skipping`);
    return;
  }

  const fields: string[] = ["updated_at", String(Date.now())];
  if (email) fields.push("email", email);
  if (name !== null) fields.push("name", name);
  await redis.sendCommand(["HSET", k.user(user.id), ...fields]);
  if (email && email !== user.email) {
    // Re-point the unique email reverse index at this user.
    await redis.set(k.userByEmail(email), user.id);
  }
  if (clerkId !== user.clerk_id) {
    await linkClerkId(redis, user.id, clerkId, name);
  }

  console.log(`[clerkWebhook] updated user ${clerkId}`);
}

async function handleUserDeleted(data: ClerkUserData): Promise<void> {
  console.log(`[clerkWebhook] user.deleted received for clerk ${data.id} (no-op)`);
}

clerkWebhookRouter.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    if (!CLERK_WEBHOOK_SECRET) {
      console.error("[clerkWebhook] CLERK_WEBHOOK_SECRET not set");
      res.status(500).json({ error: "Webhook secret not configured" });
      return;
    }

    const svixId = req.header("svix-id");
    const svixTimestamp = req.header("svix-timestamp");
    const svixSignature = req.header("svix-signature");

    if (!svixId || !svixTimestamp || !svixSignature) {
      res.status(400).json({ error: "Missing svix headers" });
      return;
    }

    const payload =
      req.body instanceof Buffer ? req.body.toString("utf8") : String(req.body);

    let event: ClerkWebhookEvent;
    try {
      const wh = new Webhook(CLERK_WEBHOOK_SECRET);
      event = wh.verify(payload, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      }) as ClerkWebhookEvent;
    } catch (err) {
      console.error(
        "[clerkWebhook] signature verification failed:",
        (err as Error).message
      );
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    try {
      switch (event.type) {
        case "user.created":
          await handleUserCreated(event.data);
          break;
        case "user.updated":
          await handleUserUpdated(event.data);
          break;
        case "user.deleted":
          await handleUserDeleted(event.data);
          break;
        default:
          console.log(`[clerkWebhook] ignoring event type ${event.type}`);
      }
      res.status(200).json({ received: true });
    } catch (err) {
      console.error(
        `[clerkWebhook] handler error for ${event.type}:`,
        (err as Error).message
      );
      res.status(500).json({ error: "Handler failed" });
    }
  }
);
