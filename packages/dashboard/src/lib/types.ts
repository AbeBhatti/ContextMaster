export type WorkspaceRole = "owner" | "editor" | "viewer" | "member";

export type KbType = "software" | "research" | "business" | "course" | "general";

export type ChunkType =
  | "decision"
  | "decisions"
  | "state"
  | "convention"
  | "conventions"
  | "finding"
  | "findings"
  | "question"
  | "questions"
  | "reference"
  | "references"
  | "context"
  | "session_summary";

export interface User {
  id: string;
  clerk_id: string;
  email: string;
  name: string | null;
  created_at: string;
}

export interface WorkspaceMember {
  user_id: string;
  name: string;
  email?: string;
  role?: WorkspaceRole;
  joined_at?: string;
}

export type RetrievalScope = "open" | "restricted";

export interface WorkspaceSummary {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  organization_id: string | null;
  is_default: boolean;
  retrieval_scope?: RetrievalScope;
  created_at: string;
  updated_at: string;
  kb_count: number;
  chunk_count: number;
  last_updated: string;
  members: WorkspaceMember[];
  role: "owner" | "member";
}

export interface KnowledgeBase {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  kb_type: KbType | string;
  summary: string | null;
  last_session_summary: string | null;
  chunk_count: number;
  is_shared: boolean;
  is_system?: boolean;
  created_at: string;
  updated_at: string;
  topic_tags?: string[];
}

export interface WorkspaceDetail {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  organization_id: string | null;
  is_default: boolean;
  retrieval_scope?: RetrievalScope;
  created_at: string;
  updated_at: string;
  role: WorkspaceRole;
  knowledge_bases: KnowledgeBase[];
  members: WorkspaceMember[];
}

export interface ChunkAuthor {
  id: string | null;
  name: string | null;
}

export interface ChunkSession {
  tool_used: string | null;
  summary: string | null;
}

export interface Chunk {
  id: string;
  knowledge_base_id: string;
  content: string;
  chunk_type: string;
  topic_tags: string[];
  related_chunk_ids?: string[];
  source_type: string;
  source_document_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  created_by: ChunkAuthor;
  session: ChunkSession | null;
}

export interface PaginatedChunks {
  chunks: Chunk[];
  total: number;
  offset: number;
  limit: number;
}

export interface ChunkFilters {
  offset?: number;
  limit?: number;
  chunk_type?: string;
  status?: string;
  search?: string;
  topic_tags?: string[];
}

export interface UpdateChunkInput {
  content?: string;
  chunk_type?: string;
  topic_tags?: string[];
}

export interface DocumentRecord {
  id: string;
  knowledge_base_id: string;
  knowledge_base_name?: string;
  file_name: string;
  file_type: string;
  file_size: number;
  storage_path: string;
  processing_status: string;
  processing_error: string | null;
  chunk_count: number;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

export interface SessionEntry {
  id: string;
  user: { id: string; name: string; email?: string };
  tool_used: string | null;
  timestamp: string;
  summary: string | null;
  chunks_added: number;
  chunks_superseded: number;
  knowledge_bases: { id: string; name: string }[];
  // Server-side path affordances. Both null/false on sessions produced by
  // POST /mcp/commit (client-side extraction).
  conversation_text_available?: boolean;
  job_id?: string | null;
}

// ============================================
// Server-side extraction jobs (processing_jobs table)
// ============================================
export type JobStatus = "queued" | "processing" | "completed" | "failed";

export interface ProcessingJobSummary {
  id: string;
  knowledge_base_id: string;
  knowledge_base_name: string | null;
  status: JobStatus;
  tool_used: string | null;
  chunks_created: number | null;
  chunks_deduplicated: number | null;
  chunks_superseded: number | null;
  extraction_model: string | null;
  extraction_ms: number | null;
  pipeline_ms: number | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface ProcessingJob extends ProcessingJobSummary {
  user_id: string;
  // Only populated by GET /api/jobs/:id.
  conversation_text?: string;
  result_json?: {
    stored?: number;
    deduplicated?: number;
    superseded?: number;
    passes?: number;
    session_id?: string;
  } | null;
}

export interface JobsListResponse {
  jobs: ProcessingJobSummary[];
  total: number;
}

export interface JobListFilters {
  status?: JobStatus;
  limit?: number;
  offset?: number;
}

export interface HistoryFilters {
  user_id?: string;
  knowledge_base_id?: string;
  limit?: number;
}

export interface Invite {
  id: string;
  email: string;
  role: string;
  token: string;
  expires_at: string;
  created_at: string;
}

export interface TeamResponse {
  members: WorkspaceMember[];
  invites: Invite[];
}

export interface InvitePreview {
  email: string;
  role: string;
  expires_at: string;
  accepted: boolean;
  expired: boolean;
  workspace: { name: string; description: string | null } | null;
}

export interface ApiKey {
  id: string;
  key_prefix: string;
  name: string | null;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface CreatedApiKey {
  id: string;
  key_prefix: string;
  name: string | null;
  created_at: string;
  key: string;
}

export interface CreateWorkspaceInput {
  name: string;
  description?: string;
  organization_id?: string;
}

export interface UpdateWorkspaceInput {
  name?: string;
  description?: string;
  retrieval_scope?: RetrievalScope;
}

export interface CreateKnowledgeBaseInput {
  name: string;
  description?: string;
  kb_type?: string;
}

// ============================================
// Organizations
// ============================================
export type OrgRole = "owner" | "admin" | "member";

export interface OrgMember {
  user_id: string;
  role: OrgRole;
  name: string;
  email?: string;
  joined_at?: string;
}

export interface OrgWorkspace {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  organization_id: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrgSharedKb {
  id: string;
  name: string;
  description: string | null;
  kb_type: string;
  workspace_id: string;
  is_shared: boolean;
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  role: OrgRole;
  member_count: number;
  workspace_count: number;
}

export interface OrganizationDetail {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  role: OrgRole;
  members: OrgMember[];
  workspaces: OrgWorkspace[];
  shared_knowledge_bases: OrgSharedKb[];
}

export interface CreateOrganizationInput {
  name: string;
}

export interface AddOrgMemberInput {
  email?: string;
  user_id?: string;
  role?: OrgRole;
}

export interface CreateSharedKbInput {
  name: string;
  description?: string;
  kb_type?: string;
}

// ============================================
// Notifications
// ============================================
export type NotificationType =
  | "commit"
  | "document_upload"
  | "invite_accepted"
  | "invite_sent"
  | "member_joined"
  | "member_removed";

export interface NotificationActor {
  id: string;
  name: string;
  email?: string;
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
  actor: NotificationActor | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationsResponse {
  notifications: Notification[];
  total: number;
  offset: number;
  limit: number;
}

// ============================================
// Billing
// ============================================
export type BillingPlan = "free" | "pro" | "team";

export interface SubscriptionStatus {
  plan: BillingPlan;
  status: string;
  early_access: boolean;
  features: { all: boolean };
}
