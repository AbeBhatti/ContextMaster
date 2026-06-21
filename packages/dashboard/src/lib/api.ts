import { API_URL } from "./constants";
import { getAuthToken } from "./auth";
import type {
  AddOrgMemberInput,
  ApiKey,
  Chunk,
  ChunkFilters,
  CreateKnowledgeBaseInput,
  CreateOrganizationInput,
  CreateSharedKbInput,
  CreateWorkspaceInput,
  CreatedApiKey,
  DocumentRecord,
  HistoryFilters,
  Invite,
  InvitePreview,
  JobListFilters,
  JobsListResponse,
  KnowledgeBase,
  Notification,
  NotificationsResponse,
  ProcessingJob,
  SubscriptionStatus,
  OrganizationDetail,
  OrganizationSummary,
  OrgRole,
  OrgSharedKb,
  PaginatedChunks,
  SessionEntry,
  TeamResponse,
  UpdateChunkInput,
  UpdateWorkspaceInput,
  User,
  WorkspaceDetail,
  WorkspaceSummary,
} from "./types";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
  formData?: FormData;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(`${API_URL}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {};
  const token = await getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers,
    body,
    signal: opts.signal,
  });

  if (!res.ok) {
    let errBody: unknown = null;
    let message = `${res.status} ${res.statusText}`;
    try {
      errBody = await res.json();
      if (errBody && typeof errBody === "object" && "error" in errBody) {
        message = String((errBody as { error: unknown }).error);
      }
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, message, errBody);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const api = {
  auth: {
    me(signal?: AbortSignal): Promise<User> {
      return request<User>("/api/auth/me", { signal });
    },
    listApiKeys(signal?: AbortSignal): Promise<ApiKey[]> {
      return request<{ api_keys: ApiKey[] }>("/api/auth/api-keys", { signal }).then(
        (r) => r.api_keys
      );
    },
    createApiKey(name: string): Promise<CreatedApiKey> {
      return request<CreatedApiKey>("/api/auth/api-keys", {
        method: "POST",
        body: { name },
      });
    },
    revokeApiKey(id: string): Promise<void> {
      return request<void>(`/api/auth/api-keys/${id}`, { method: "DELETE" });
    },
  },

  workspaces: {
    list(signal?: AbortSignal): Promise<WorkspaceSummary[]> {
      return request<{ workspaces: WorkspaceSummary[] }>("/api/workspaces", {
        signal,
      }).then((r) => r.workspaces);
    },
    get(id: string, signal?: AbortSignal): Promise<WorkspaceDetail> {
      return request<WorkspaceDetail>(`/api/workspaces/${id}`, { signal });
    },
    create(data: CreateWorkspaceInput): Promise<WorkspaceSummary> {
      return request<WorkspaceSummary>("/api/workspaces", {
        method: "POST",
        body: data,
      });
    },
    update(id: string, data: UpdateWorkspaceInput): Promise<WorkspaceSummary> {
      return request<WorkspaceSummary>(`/api/workspaces/${id}`, {
        method: "PATCH",
        body: data,
      });
    },
    delete(id: string): Promise<void> {
      return request<void>(`/api/workspaces/${id}`, { method: "DELETE" });
    },
  },

  knowledgeBases: {
    list(workspaceId: string, signal?: AbortSignal): Promise<KnowledgeBase[]> {
      return request<{ knowledge_bases: KnowledgeBase[] }>(
        `/api/workspaces/${workspaceId}/knowledge-bases`,
        { signal }
      ).then((r) => r.knowledge_bases);
    },
    create(
      workspaceId: string,
      data: CreateKnowledgeBaseInput
    ): Promise<KnowledgeBase> {
      return request<KnowledgeBase>(
        `/api/workspaces/${workspaceId}/knowledge-bases`,
        { method: "POST", body: data }
      );
    },
    update(
      kbId: string,
      data: { name?: string; description?: string; kb_type?: string; summary?: string }
    ): Promise<KnowledgeBase> {
      return request<KnowledgeBase>(`/api/knowledge-bases/${kbId}`, {
        method: "PATCH",
        body: data,
      });
    },
    getChunks(
      workspaceId: string,
      kbId: string,
      filters: ChunkFilters = {},
      signal?: AbortSignal
    ): Promise<PaginatedChunks> {
      const query: Record<string, string | number | undefined> = {
        offset: filters.offset,
        limit: filters.limit,
        chunk_type: filters.chunk_type,
        status: filters.status,
        search: filters.search,
        topic_tags: filters.topic_tags?.join(","),
      };
      return request<PaginatedChunks>(
        `/api/workspaces/${workspaceId}/knowledge-bases/${kbId}/chunks`,
        { query, signal }
      );
    },
    updateChunk(
      kbId: string,
      chunkId: string,
      data: UpdateChunkInput
    ): Promise<Chunk> {
      return request<Chunk>(`/api/knowledge-bases/${kbId}/chunks/${chunkId}`, {
        method: "PATCH",
        body: data,
      });
    },
    deleteChunk(kbId: string, chunkId: string): Promise<void> {
      return request<void>(`/api/knowledge-bases/${kbId}/chunks/${chunkId}`, {
        method: "DELETE",
      });
    },
    move(kbId: string, targetWorkspaceId: string): Promise<KnowledgeBase> {
      return request<KnowledgeBase>(`/api/knowledge-bases/${kbId}/move`, {
        method: "POST",
        body: { target_workspace_id: targetWorkspaceId },
      });
    },
    copy(kbId: string, targetWorkspaceId: string): Promise<KnowledgeBase> {
      return request<KnowledgeBase>(`/api/knowledge-bases/${kbId}/copy`, {
        method: "POST",
        body: { target_workspace_id: targetWorkspaceId },
      });
    },
    delete(
      kbId: string
    ): Promise<{ success: boolean; deleted: { id: string; name: string } }> {
      return request<{ success: boolean; deleted: { id: string; name: string } }>(
        `/api/knowledge-bases/${kbId}`,
        { method: "DELETE" }
      );
    },
  },

  documents: {
    list(workspaceId: string, signal?: AbortSignal): Promise<DocumentRecord[]> {
      return request<{ documents: DocumentRecord[] }>(
        `/api/workspaces/${workspaceId}/documents`,
        { signal }
      ).then((r) => r.documents);
    },
    upload(
      workspaceId: string,
      file: File,
      knowledgeBaseId: string
    ): Promise<DocumentRecord> {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("knowledge_base_id", knowledgeBaseId);
      return request<DocumentRecord>(`/api/workspaces/${workspaceId}/documents`, {
        method: "POST",
        formData: fd,
      });
    },
    delete(docId: string): Promise<void> {
      return request<void>(`/api/documents/${docId}`, { method: "DELETE" });
    },
    getChunks(docId: string, signal?: AbortSignal): Promise<Chunk[]> {
      return request<{ chunks: Chunk[] }>(`/api/documents/${docId}/chunks`, {
        signal,
      }).then((r) => r.chunks);
    },
  },

  history: {
    get(
      workspaceId: string,
      filters: HistoryFilters = {},
      signal?: AbortSignal
    ): Promise<SessionEntry[]> {
      const query: Record<string, string | number | undefined> = {
        user_id: filters.user_id,
        knowledge_base_id: filters.knowledge_base_id,
        limit: filters.limit,
      };
      return request<{ sessions: SessionEntry[] }>(
        `/api/workspaces/${workspaceId}/history`,
        { query, signal }
      ).then((r) => r.sessions);
    },
  },

  team: {
    get(workspaceId: string, signal?: AbortSignal): Promise<TeamResponse> {
      return request<TeamResponse>(`/api/workspaces/${workspaceId}/team`, {
        signal,
      });
    },
    invite(workspaceId: string, email: string, role: string): Promise<Invite> {
      return request<Invite>(`/api/workspaces/${workspaceId}/invites`, {
        method: "POST",
        body: { email, role },
      });
    },
    revokeInvite(workspaceId: string, inviteId: string): Promise<void> {
      return request<void>(
        `/api/workspaces/${workspaceId}/invites/${inviteId}`,
        { method: "DELETE" }
      );
    },
    previewInvite(token: string, signal?: AbortSignal): Promise<InvitePreview> {
      return request<InvitePreview>(`/api/invites/${token}/preview`, { signal });
    },
    acceptInvite(token: string): Promise<{ workspace_id: string }> {
      return request<{ workspace_id: string }>(`/api/invites/${token}/accept`, {
        method: "POST",
      });
    },
    updateMemberRole(
      workspaceId: string,
      userId: string,
      role: string
    ): Promise<{ user_id: string; role: string }> {
      return request<{ user_id: string; role: string }>(
        `/api/workspaces/${workspaceId}/members/${userId}`,
        { method: "PATCH", body: { role } }
      );
    },
    removeMember(workspaceId: string, userId: string): Promise<void> {
      return request<void>(
        `/api/workspaces/${workspaceId}/members/${userId}`,
        { method: "DELETE" }
      );
    },
  },

  organizations: {
    list(signal?: AbortSignal): Promise<OrganizationSummary[]> {
      return request<{ organizations: OrganizationSummary[] }>(
        "/api/organizations",
        { signal }
      ).then((r) => r.organizations);
    },
    get(id: string, signal?: AbortSignal): Promise<OrganizationDetail> {
      return request<OrganizationDetail>(`/api/organizations/${id}`, { signal });
    },
    create(data: CreateOrganizationInput): Promise<OrganizationSummary> {
      return request<OrganizationSummary>("/api/organizations", {
        method: "POST",
        body: data,
      });
    },
    update(id: string, name: string): Promise<OrganizationSummary> {
      return request<OrganizationSummary>(`/api/organizations/${id}`, {
        method: "PATCH",
        body: { name },
      });
    },
    delete(id: string): Promise<void> {
      return request<void>(`/api/organizations/${id}`, { method: "DELETE" });
    },
    addMember(id: string, data: AddOrgMemberInput): Promise<unknown> {
      return request<unknown>(`/api/organizations/${id}/members`, {
        method: "POST",
        body: data,
      });
    },
    removeMember(id: string, userId: string): Promise<void> {
      return request<void>(`/api/organizations/${id}/members/${userId}`, {
        method: "DELETE",
      });
    },
    updateMemberRole(
      id: string,
      userId: string,
      role: OrgRole
    ): Promise<unknown> {
      return request<unknown>(`/api/organizations/${id}/members/${userId}`, {
        method: "PATCH",
        body: { role },
      });
    },
    createSharedKb(id: string, data: CreateSharedKbInput): Promise<OrgSharedKb> {
      return request<OrgSharedKb>(`/api/organizations/${id}/shared-kbs`, {
        method: "POST",
        body: data,
      });
    },
    listSharedKbs(id: string, signal?: AbortSignal): Promise<OrgSharedKb[]> {
      return request<{ shared_knowledge_bases: OrgSharedKb[] }>(
        `/api/organizations/${id}/shared-kbs`,
        { signal }
      ).then((r) => r.shared_knowledge_bases);
    },
  },

  billing: {
    subscription(signal?: AbortSignal): Promise<SubscriptionStatus> {
      return request<SubscriptionStatus>("/api/billing/subscription", { signal });
    },
  },

  jobs: {
    list(
      workspaceId: string,
      filters: JobListFilters = {},
      signal?: AbortSignal
    ): Promise<JobsListResponse> {
      const query: Record<string, string | number | undefined> = {
        status: filters.status,
        limit: filters.limit,
        offset: filters.offset,
      };
      return request<JobsListResponse>(
        `/api/workspaces/${workspaceId}/jobs`,
        { query, signal }
      );
    },
    get(jobId: string, signal?: AbortSignal): Promise<ProcessingJob> {
      return request<ProcessingJob>(`/api/jobs/${jobId}`, { signal });
    },
    reExtract(jobId: string): Promise<{ job_id: string; status: string }> {
      return request<{ job_id: string; status: string }>(
        `/api/jobs/${jobId}/re-extract`,
        { method: "POST" }
      );
    },
  },

  notifications: {
    list(
      opts: { limit?: number; offset?: number; unread?: boolean } = {},
      signal?: AbortSignal
    ): Promise<NotificationsResponse> {
      const query: Record<string, string | number | undefined> = {
        limit: opts.limit,
        offset: opts.offset,
        unread: opts.unread ? "true" : undefined,
      };
      return request<NotificationsResponse>("/api/notifications", {
        query,
        signal,
      });
    },
    unreadCount(signal?: AbortSignal): Promise<number> {
      return request<{ unread: number }>("/api/notifications/unread-count", {
        signal,
      }).then((r) => r.unread);
    },
    markRead(payload: { ids?: string[]; all?: boolean }): Promise<void> {
      return request<void>("/api/notifications/read", {
        method: "POST",
        body: payload,
      });
    },
  },
};

export type { Notification };
