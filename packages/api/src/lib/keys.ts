// Central Redis key schema. Every key is namespaced under REDIS_PREFIX so
// multiple logical environments can share one Redis instance if needed.
//
// This is the Redis analogue of the reference's Postgres tables:
//   knowledge_chunks  -> Hash  cm:chunk:{id}      (indexed by idx:chunks)
//   knowledge_bases   -> Hash  cm:kb:{id}         (indexed by idx:kbs)
//   users/workspaces/sessions/... -> Hashes + secondary-index Sets
//   processing_jobs   -> Stream cm:jobs:stream    (consumer group cm:jobs:workers)

const PREFIX = process.env.REDIS_PREFIX || "cm";

export const keyPrefix = PREFIX;

// ---- Hash record prefixes (used by FT.CREATE ... PREFIX) ----
export const chunkPrefix = `${PREFIX}:chunk:`;
export const kbPrefix = `${PREFIX}:kb:`;

export const k = {
  // Core knowledge data (indexed)
  chunk: (id: string) => `${chunkPrefix}${id}`,
  kb: (id: string) => `${kbPrefix}${id}`,

  // Users + lookups (clerk_id / email are UNIQUE in the reference schema)
  user: (id: string) => `${PREFIX}:user:${id}`,
  userByClerk: (clerkId: string) => `${PREFIX}:user:clerk:${clerkId}`,
  userByEmail: (email: string) => `${PREFIX}:user:email:${email.toLowerCase()}`,
  userWorkspaces: (userId: string) => `${PREFIX}:user:${userId}:workspaces`, // Set of workspace ids
  userApiKeys: (userId: string) => `${PREFIX}:user:${userId}:apikeys`, // Set of api key ids

  // Organizations
  org: (id: string) => `${PREFIX}:org:${id}`,
  orgMembers: (orgId: string) => `${PREFIX}:org:${orgId}:members`, // Hash userId -> role
  orgWorkspaces: (orgId: string) => `${PREFIX}:org:${orgId}:workspaces`, // Set of workspace ids
  userOrgs: (userId: string) => `${PREFIX}:user:${userId}:orgs`, // reverse: Set of org ids (member of)

  // Workspaces (access-control + retrieval boundary)
  workspace: (id: string) => `${PREFIX}:workspace:${id}`,
  workspaceMembers: (wsId: string) => `${PREFIX}:workspace:${wsId}:members`, // Hash userId -> role
  workspaceKbs: (wsId: string) => `${PREFIX}:workspace:${wsId}:kbs`, // Set of kb ids
  // Reverse of workspaceMembers: every workspace the user is a direct member
  // of (not owner). The "deferred per-user membership set" — lets
  // getUserWorkspaceIds resolve member workspaces without scanning.
  userWorkspaceMemberships: (userId: string) => `${PREFIX}:user:${userId}:workspace-memberships`,

  // Knowledge base -> its chunks / documents (for batch delete + counts)
  kbChunks: (kbId: string) => `${PREFIX}:kb:${kbId}:chunks`, // Set of chunk ids
  kbDocs: (kbId: string) => `${PREFIX}:kb:${kbId}:documents`, // Set of document ids
  kbSessions: (kbId: string) => `${PREFIX}:kb:${kbId}:sessions`, // Sorted set of session ids by created_at
  kbJobs: (kbId: string) => `${PREFIX}:kb:${kbId}:jobs`, // Sorted set of job ids by created_at

  // Sessions
  session: (id: string) => `${PREFIX}:session:${id}`,
  userSessions: (userId: string) => `${PREFIX}:user:${userId}:sessions`, // Sorted set by created_at
  sessionJob: (sessionId: string) => `${PREFIX}:session:${sessionId}:job`, // string jobId (server-side path)

  // Documents (metadata; file bytes live on local disk at STORAGE_DIR)
  doc: (id: string) => `${PREFIX}:doc:${id}`,

  // API keys: O(1) auth lookup keyHash -> userId, plus a metadata hash
  apiKeyByHash: (keyHash: string) => `${PREFIX}:apikey:hash:${keyHash}`, // string userId
  apiKeyMeta: (id: string) => `${PREFIX}:apikey:${id}`, // Hash

  // Invites
  invite: (token: string) => `${PREFIX}:invite:${token}`,
  workspaceInvites: (wsId: string) => `${PREFIX}:workspace:${wsId}:invites`, // Set of tokens

  // Notifications
  notification: (id: string) => `${PREFIX}:notification:${id}`,
  userNotifications: (userId: string) => `${PREFIX}:user:${userId}:notifications`, // Sorted set

  // Super-commit usage accounting (per user per day)
  superCommitUsage: (userId: string, day: string) => `${PREFIX}:usage:supercommit:${userId}:${day}`,

  // OAuth (RFC 7591 dynamic clients + authorization codes). Replaces the
  // reference's oauth_clients / oauth_authorization_codes Postgres tables.
  oauthClient: (clientId: string) => `${PREFIX}:oauth:client:${clientId}`, // Hash
  oauthCode: (code: string) => `${PREFIX}:oauth:code:${code}`, // Hash (10-min TTL)

  // Server-side extraction jobs
  jobsStream: `${PREFIX}:jobs:stream`,
  job: (id: string) => `${PREFIX}:job:${id}`,
  userJobs: (userId: string) => `${PREFIX}:user:${userId}:jobs`, // Sorted set
} as const;

// ---- RediSearch index names ----
export const idx = {
  chunks: `${PREFIX}:idx:chunks`,
  kbs: `${PREFIX}:idx:kbs`,
} as const;

// ---- Streams consumer group ----
export const JOBS_GROUP = `${PREFIX}:jobs:workers`;
