import type { RedisClient } from "./redis.js";
import type { User } from "./types.js";
import {
  getUserByClerkId,
  getUserByEmail,
  createUser,
  linkClerkId,
} from "./userRepo.js";
import { createWorkspace, addWorkspaceMember } from "./workspaceRepo.js";
import { createKb, setChunkCount } from "./kbRepo.js";
import { insertChunks } from "./chunkRepo.js";
import {
  GETTING_STARTED_CHUNKS,
  GETTING_STARTED_KB_META,
} from "../data/gettingStartedKB.js";

// Higher-level user provisioning. Ports the reference's two near-identical
// provisioning paths (clerkAuth.upsertUser + clerkWebhook.handleUserCreated)
// into one Redis-backed helper so the JWT path, the bypass path, and the
// webhook all converge on identical state: a user, a default "General"
// workspace, an owner membership row, and the built-in Getting Started KB.

export interface ClerkIdentity {
  clerkId: string;
  email: string;
  name?: string | null;
}

// Find-or-create a user from a Clerk identity. Match order mirrors the
// reference: by clerk_id, then by email (linking the clerk_id onto a
// pre-existing row), then create-and-provision.
export async function upsertUserFromClerk(
  redis: RedisClient,
  identity: ClerkIdentity
): Promise<User> {
  const byClerk = await getUserByClerkId(redis, identity.clerkId);
  if (byClerk) return byClerk;

  const byEmail = await getUserByEmail(redis, identity.email);
  if (byEmail) {
    return linkClerkId(redis, byEmail.id, identity.clerkId, identity.name);
  }

  const user = await createUser(redis, {
    clerk_id: identity.clerkId,
    email: identity.email,
    name: identity.name ?? null,
  });

  await provisionDefaults(redis, user.id);
  return user;
}

// Create the default workspace + owner membership + Getting Started KB for a
// freshly created user. Best-effort: a failure to seed onboarding content must
// not break sign-in, so KB provisioning is wrapped and logged.
export async function provisionDefaults(
  redis: RedisClient,
  userId: string
): Promise<void> {
  const ws = await createWorkspace(redis, {
    name: "General",
    owner_id: userId,
    is_default: true,
    description: "Default workspace for personal knowledge",
  });
  await addWorkspaceMember(redis, ws.id, userId, "owner");

  try {
    await provisionGettingStartedKb(redis, ws.id, userId);
  } catch (err) {
    console.error(
      "[provisioning] Getting Started KB seed failed:",
      (err as Error).message
    );
  }
}

// Seed the built-in product manual KB. Chunks ship with precomputed embeddings
// (data/gettingStartedKB.ts), so no OpenAI call is needed here — mirrors the
// reference's webhook provisioning.
export async function provisionGettingStartedKb(
  redis: RedisClient,
  workspaceId: string,
  userId: string
): Promise<void> {
  const kb = await createKb(redis, {
    workspace_id: workspaceId,
    name: GETTING_STARTED_KB_META.name,
    description: GETTING_STARTED_KB_META.description,
    kb_type: GETTING_STARTED_KB_META.type,
  });

  const nowIso = new Date().toISOString();
  await insertChunks(
    redis,
    GETTING_STARTED_CHUNKS.map((chunk) => ({
      row: {
        knowledge_base_id: kb.id,
        content: chunk.content,
        chunk_type: chunk.chunk_type,
        topic_tags: chunk.topic_tags,
        related_chunk_ids: [],
        source_type: "system",
        status: "active",
        created_by: userId,
        session_id: null,
        topic_key: null,
        valid_from: nowIso,
      },
      embedding: chunk.embedding,
    }))
  );

  await setChunkCount(redis, kb.id, GETTING_STARTED_CHUNKS.length);
}
