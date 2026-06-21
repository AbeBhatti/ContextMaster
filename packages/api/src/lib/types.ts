// Domain types — ported verbatim from the reference's packages/api/src/lib/
// supabase.ts so the service/route logic transfers unchanged. The data layer
// underneath these is Redis instead of Postgres; the shapes are identical.

export interface User {
  id: string;
  clerk_id: string;
  email: string;
  name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  organization_id: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeBase {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  auto_description: string | null;
  description_embedding: number[] | null;
  kb_type: string;
  summary: string | null;
  last_session_summary: string | null;
  chunk_count: number;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeChunk {
  id: string;
  knowledge_base_id: string;
  content: string;
  chunk_type: string;
  topic_tags: string[];
  related_chunk_ids: string[];
  source_type: string;
  source_document_id: string | null;
  status: string;
  superseded_by: string | null;
  supersedes: string | null;
  embedding: number[] | null;
  created_by: string | null;
  session_id: string | null;
  // Kebab-case identifier for state/decision chunks. When a new chunk arrives
  // with the same topic_key, the existing chunk is superseded deterministically
  // (Stage 4) rather than relying on cosine-similarity dedup.
  topic_key: string | null;
  // Bi-temporal validity. valid_from is set to the session's created_at on
  // insert; valid_to is set to the superseding chunk's valid_from when the row
  // is superseded. valid_to = NULL means the fact is current.
  valid_from: string | null;
  valid_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  tool_used: string | null;
  knowledge_bases_used: string[];
  chunks_added: number;
  chunks_superseded: number;
  session_summary: string | null;
  conversation_text?: string | null;
  created_at: string;
}

export interface Document {
  id: string;
  knowledge_base_id: string;
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

export interface ApiKey {
  id: string;
  user_id: string;
  key_hash: string;
  key_prefix: string;
  name: string | null;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

// ---- Retrieval result shapes (what the RPC replacements return) ----

export interface RecallResult {
  id: string;
  knowledge_base_id: string;
  content: string;
  chunk_type: string;
  topic_tags: string[];
  related_chunk_ids: string[];
  source_type: string;
  status: string;
  similarity: number;
  created_at: string;
  created_by: string | null;
}

export interface SimilarChunkResult {
  id: string;
  content: string;
  chunk_type: string;
  session_id: string | null;
  similarity: number;
}

// ---- API request shapes (ported from the reference) ----

export interface CommitChunkInput {
  content: string;
  chunk_type: string;
  topic_tags?: string[];
  related_to?: string[];
  // Two-pass extraction: a temporary label within a commit; other chunks link
  // to it via related_to_labels, resolved to UUIDs after storeChunks runs.
  label?: string;
  related_to_labels?: string[];
  // Kebab-case identifier for state/decision chunks. Drives topic-key
  // supersession (Stage 4).
  topic_key?: string;
}

export interface CommitRequest {
  knowledge_base_id: string | null;
  new_knowledge_base?: {
    name: string;
    description: string;
    kb_type: string;
    workspace_id?: string;
  };
  chunks: CommitChunkInput[];
  session_summary: string;
  next_steps?: string;
  open_questions?: string;
  kb_description_update?: string;
  tool_used?: string;
  skip_coverage_verification?: boolean;
  enhanced?: boolean;
}

export interface RecallRequest {
  query: string;
  knowledge_base_ids?: string[];
  knowledge_base?: string;
  workspace?: string;
  max_results?: number;
  chunk_types?: string[];
}
