import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const MCP_SERVER_NAME = "contextmaster";
export const MCP_SERVER_VERSION = "0.1.0";

// Server-level instructions — the load-bearing signal that tells the assistant
// when to use memory vs chat-history search. Kept in lockstep with the stdio
// client (packages/mcp-client/src/index.ts).
export const MCP_INSTRUCTIONS = `You have cntxt connected — a persistent memory system with the user's knowledge bases containing decisions, findings, conventions, and project context from prior sessions.

DEFAULT BEHAVIOR: Call check_memory on your FIRST substantive response in every conversation. This is not optional — treat it like checking your memory before speaking. The only exceptions are purely factual questions with no personal context ('what is a REST API', 'how do I center a div'). If there is ANY chance the user has relevant prior context, check first.

After check_memory returns, if any knowledge base is relevant to what the user is discussing, call search_memory to get specifics. Use the results to ground your response — don't mention that you checked, just use the knowledge naturally.

At natural stopping points (decisions made, work completed, session ending), proactively suggest saving: 'Want me to save our progress?' The user says 'save this' or agrees, then call save_memory.

GETTING STARTED KB: If the user asks how cntxt works, how to use it, or has any product questions ('how do I save?', 'how do workspaces work?', 'what can you do?'), search the 'Getting Started' knowledge base first. It contains comprehensive product documentation. Don't answer product questions from your general knowledge — search the KB so your answer is grounded in the actual documentation.

IMPORTANT: You are not a separate tool the user invokes. You are the user's memory. Act like it — check automatically, recall silently, suggest saving naturally.`;

// The MCP transport handlers run in the same process as the REST routes, so we
// forward tool calls to the existing /mcp/* endpoints over localhost. Every
// transport (stdio, Streamable HTTP, SSE) hits the same code path.
const PORT = parseInt(process.env.PORT ?? "3001", 10);
const INTERNAL_BASE = `http://127.0.0.1:${PORT}`;

async function callInternal(opts: {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  apiKey: string;
  body?: unknown;
  query?: Record<string, string>;
}): Promise<any> {
  const url = new URL(INTERNAL_BASE + opts.path);
  if (opts.query) {
    for (const [key, value] of Object.entries(opts.query)) url.searchParams.set(key, value);
  }
  const res = await fetch(url, {
    method: opts.method,
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: any = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: text };
    }
  }
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json;
}

export function registerTools(server: McpServer, apiKey: string): void {
  // ---- Tool 1: check_memory ----
  server.registerTool(
    "check_memory",
    {
      description: `Retrieve the user's shared team memory index — all workspaces, knowledge bases, session summaries, and the most recently active KB. Returns structured metadata (names, descriptions, chunk counts, last-updated timestamps) for every accessible knowledge base, including those shared by teammates. Use this to orient before any retrieval or to identify which knowledge base to search or save to.

Returns:
- most_recent_kb: the single KB the user was last working in (from their latest session). USE THIS when the user says "pick up where we left off", "let's keep working", "continue", or any unscoped continuation phrase that doesn't name a specific project.
- workspaces[].knowledge_bases: all KBs, sorted within each workspace by most-recently-updated first.
- shared_knowledge_bases: KBs shared from teammates' workspaces.

Each KB carries: name, description, last_session_summary, last_updated, chunk_count.

Call this as a PRECURSOR to any retrieval — the moment you need to know what the user is talking about and the answer isn't in the current conversation.

Trigger phrases — call this tool when the user says anything like: 'where did we leave off', 'what were we working on', 'continue from last time', 'pick up where I left off', 'what did we decide about...', 'what do we know about...', 'catch me up', "what's the status of...", "let's keep going", 'check my memory', "what's in my knowledge base", or references any past work, project, or decision by name.

Default behavior: when in doubt, check. A quick memory check is better than asking the user to re-explain.

DO NOT call this on every conversation start ceremonially, for self-contained factual questions, for greetings, or when you already have the relevant KB IDs from earlier in this same conversation.

After calling: pick the relevant KB(s), then call search_memory against the picked KB IDs for specifics. Don't dump the raw response to the user — just use the result to ground your reply.`,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const data = await callInternal({ method: "GET", path: "/mcp/context", apiKey });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ---- Tool 2: search_memory ----
  server.registerTool(
    "search_memory",
    {
      description: `Search your knowledge bases. You can specify knowledge_base_ids or knowledge_base to narrow the search, but if omitted, the server automatically searches the most relevant knowledge bases for your query using semantic routing.

Returns typed knowledge chunks (decisions, findings, conventions, state, questions, references) with author attribution and timestamps. Searches across all accessible knowledge bases — including those shared by teammates.

You can search in several ways:
- Broad search: just pass a query with no filters. Best when you're not sure where the answer lives.
- By knowledge base ID: pass knowledge_base_ids from check_memory results.
- By knowledge base name: pass the name the user mentioned (e.g., 'SaaS Project'). The system resolves it.
- By workspace name: pass the workspace name (e.g., 'business', 'ml'). Searches all KBs in that workspace.

Use broad search by default. Only narrow when the user explicitly mentions a specific project, knowledge base, or workspace.

Results tagged with [from knowledge base] are existing context. When committing later, do NOT re-extract these — only extract NEW information from this session.

When continuing previous work or answering questions that span multiple topics, make 2-3 TARGETED search_memory calls with different queries rather than relying on one broad search.`,
      inputSchema: {
        query: z.string().describe("Natural language description of what to retrieve"),
        knowledge_base_ids: z
          .array(z.string())
          .optional()
          .describe("IDs of specific knowledge bases to search (from check_memory)."),
        knowledge_base: z
          .string()
          .optional()
          .describe("Name of a specific knowledge base to search. The system resolves the name."),
        workspace: z
          .string()
          .optional()
          .describe("Name of a workspace to search within. Searches all KBs in that workspace."),
        max_results: z.number().optional().default(16).describe("Maximum number of chunks to return"),
        chunk_types: z
          .array(z.string())
          .optional()
          .describe("Optional filter: decision, finding, convention, state, question, reference"),
      },
      annotations: { readOnlyHint: true },
    },
    async (params: any) => {
      try {
        const data = await callInternal({
          method: "POST",
          path: "/mcp/recall",
          apiKey,
          body: {
            query: params.query,
            knowledge_base_ids: params.knowledge_base_ids,
            knowledge_base: params.knowledge_base,
            workspace: params.workspace,
            max_results: params.max_results,
            chunk_types: params.chunk_types,
          },
        });

        const taggedChunks = (data.chunks ?? []).map((chunk: any) => {
          let content = `[from knowledge base: ${chunk.knowledge_base_name}] ${chunk.content}`;
          if (Array.isArray(chunk.linked_chunks) && chunk.linked_chunks.length > 0) {
            content += `\n  Supporting context:`;
            for (const linked of chunk.linked_chunks) content += `\n  - ${linked.content}`;
          }
          return { ...chunk, content };
        });

        return {
          content: [{ type: "text", text: JSON.stringify({ chunks: taggedChunks }, null, 2) }],
        };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ---- Tool 3: save_memory (always registered) ----
  server.registerTool(
    "save_memory",
    {
      description: `Save structured knowledge chunks to Context Cloud. Prefer save_session instead — it's faster and handles extraction automatically. Use save_memory only if you've already structured the data into chunks or if save_session is unavailable.

KNOWLEDGE BASE SELECTION:
- If this session's topic clearly matches an existing KB (by name and description), use that KB's ID as knowledge_base_id.
- If this session is about something NEW that doesn't fit any existing KB, set knowledge_base_id to null and provide new_knowledge_base details.
- Create a new KB only for DISTINCT ONGOING ENDEAVORS — a project, a course, a client engagement, a research topic.

EXTRACTION RULES:
SPECIFICITY RULE — never generalize or paraphrase specific details. Preserve proper nouns, numbers, URLs/paths, technical identifiers, and quoted/exact phrases verbatim.
ATTRIBUTION RULE — preserve who made a decision/finding ("Team decided...", "User chose...").
OPERATIONAL CONTEXT RULE — always extract repo paths, deployment URLs, team members, env configs, service accounts as standalone reference chunks.

1. Do NOT re-extract information retrieved from cntxt during this session. Only extract genuinely NEW knowledge.
2. Each chunk is a self-contained knowledge unit — one decision, one finding, one convention.
3. Chunk types: decision, finding, convention, state, question, reference, context.

TOPIC KEY — for state and decision chunks ONLY: a short kebab-case identifier for WHAT is being decided/configured (e.g. "primary-database"). Future sessions reusing the same topic_key supersede this chunk. Only add it when the chunk has a SINGLE CURRENT VALUE that could change later.

The session_summary should be a DETAILED NARRATIVE (1000-1500 tokens) capturing the complete arc of the session. SAFETY NET RULE: the summary MUST mention every proper noun, number, URL, file path, deadline, and person name from the conversation.

CONTEXT EXTRACTION (Pass 2): also extract context chunks (chunk_type "context", 80-150 tokens, ONE detail each) and link them to structured chunks via related_to_labels. Extract as many as the conversation warrants.

ENHANCED COMMIT: pass enhanced: true only when the user explicitly asks for a super/deep commit.

SELF-VERIFICATION — after extraction, review the conversation once more to find specific details you missed, and add reference/context chunks for them.`,
      inputSchema: {
        knowledge_base_id: z
          .string()
          .nullable()
          .describe("Target KB ID from check_memory, or null to create new"),
        new_knowledge_base: z
          .object({
            name: z.string(),
            description: z.string(),
            kb_type: z
              .enum(["software", "research", "business", "course", "general"])
              .default("general"),
            workspace_id: z.string().optional().describe("Workspace to create in, defaults to General"),
          })
          .optional()
          .describe("Required if knowledge_base_id is null"),
        chunks: z.array(
          z.object({
            content: z.string().describe("The knowledge unit text"),
            chunk_type: z
              .enum(["decision", "finding", "convention", "state", "question", "reference", "context"])
              .describe("Type of knowledge"),
            topic_tags: z.array(z.string()).optional().describe("1-3 topic keywords"),
            related_to: z.array(z.string()).optional().describe("IDs of related chunks if known"),
            label: z
              .string()
              .optional()
              .describe("Temporary label within this commit (e.g. 'd1', 'ctx1')."),
            related_to_labels: z
              .array(z.string())
              .optional()
              .describe("Labels of OTHER chunks in this commit this chunk relates to."),
            topic_key: z
              .string()
              .optional()
              .describe("Kebab-case identifier for state/decision chunks only."),
          })
        ),
        session_summary: z
          .string()
          .describe("Brief summary of current state and what was accomplished"),
        next_steps: z.string().optional().describe("What should be worked on next"),
        open_questions: z.string().optional().describe("Unresolved questions from this session"),
        kb_description_update: z.string().optional().describe("Updated KB description if scope changed"),
        tool_used: z
          .string()
          .optional()
          .describe("Which AI tool is being used (claude_desktop, claude_code, cursor, etc.)"),
        enhanced: z
          .boolean()
          .optional()
          .default(false)
          .describe("Set to true ONLY when the user explicitly asks for a super/deep commit."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (params) => {
      try {
        const data = await callInternal({ method: "POST", path: "/mcp/commit", apiKey, body: params });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ---- Tool 4: save_session (gated on SERVER_SIDE_EXTRACTION) ----
  if (process.env.SERVER_SIDE_EXTRACTION === "true") {
    server.registerTool(
      "save_session",
      {
        description: `Save this conversation's knowledge to Context Cloud. You can optionally specify a knowledge_base_name or knowledge_base_id, but it's not required — the server will automatically route to the best matching knowledge base or create a new one based on the conversation content.

Send the conversation text and the server extracts typed chunks (decisions, findings, conventions, state) automatically in the background — no client-side extraction needed. Returns a job ID immediately (HTTP 202) so the user can keep working.

WHEN TO CALL: after significant decisions or findings, at natural topic transitions or session wrap-up, when the user says save/commit/preserve/"remember this", or periodically during long sessions.

WHAT TO SEND IN conversation_text: the substantive part of this conversation — user turns and your responses, including exact quotes, numbers, URLs, names, decisions. You may omit pure tool-call JSON, terminal log dumps, and prior recall results.

KNOWLEDGE BASE SELECTION (all optional): knowledge_base_id (UUID, wins if both passed), knowledge_base_name (string, auto-created if not found), or NEITHER (server routes to best match or creates one).

RESPONSE: { job_id, status: "queued", knowledge_base_id, kb_was_created, deferred_routing, process_after, message }. Poll GET /mcp/jobs/:id if you need confirmation.`,
        inputSchema: {
          conversation_text: z
            .string()
            .describe("The conversation content to extract knowledge from."),
          knowledge_base_id: z.string().optional().describe("Target knowledge base UUID."),
          knowledge_base_name: z
            .string()
            .optional()
            .describe("Target knowledge base name. Server looks up by name and auto-creates if not found."),
          tool_used: z.string().optional().describe("Which AI tool is in use."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async (params: any) => {
        try {
          const data = await callInternal({
            method: "POST",
            path: "/mcp/commit-raw",
            apiKey,
            body: {
              conversation_text: params.conversation_text,
              knowledge_base_id: params.knowledge_base_id,
              knowledge_base_name: params.knowledge_base_name,
              tool_used: params.tool_used,
            },
          });
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
        }
      }
    );
  }

  // ---- Tool 5: check_updates ----
  server.registerTool(
    "check_updates",
    {
      description: `Show what teammates have changed in shared knowledge bases since your last session or a specified time. Returns new chunks committed by other team members, superseded facts, and knowledge base activity — giving you a team changelog.

Use this when the user asks "what's changed"/"what's new"/"what did my teammate do", when they haven't worked on this in a while, or when you want to verify whether context you're relying on has been updated.

Present changes as a concise briefing, not a data dump.`,
      inputSchema: {
        since: z.string().optional().describe("ISO timestamp — defaults to user's last session"),
        knowledge_base_ids: z.array(z.string()).optional().describe("Optional KB IDs to filter by"),
      },
      annotations: { readOnlyHint: true },
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.since) queryParams.since = params.since;
        if (params.knowledge_base_ids) queryParams.knowledge_base_ids = params.knowledge_base_ids.join(",");
        const data = await callInternal({
          method: "GET",
          path: "/mcp/history",
          apiKey,
          query: queryParams,
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ---- Tool 6: manage_knowledge_bases ----
  server.registerTool(
    "manage_knowledge_bases",
    {
      description: `List, create, or update shared team knowledge bases within a workspace. Use 'list' to see all accessible KBs across workspaces. Use 'create' when the user is starting a new project or topic that doesn't fit any existing KB. Use 'update' to rename or re-describe a KB.

When creating: choose a clear, specific name and a description that will help future AI sessions match conversations to this KB. The description is the primary signal for automatic KB selection.`,
      inputSchema: {
        action: z.enum(["list", "create", "update"]).describe("Operation to perform"),
        workspace_id: z.string().optional().describe("For create: which workspace to create in"),
        knowledge_base_id: z.string().optional().describe("For update: which KB to modify"),
        name: z.string().optional().describe("For create/update: KB name"),
        description: z.string().optional().describe("For create/update: KB description"),
        kb_type: z
          .enum(["software", "research", "business", "course", "general"])
          .optional()
          .describe("For create: type of knowledge base"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (params) => {
      try {
        switch (params.action) {
          case "list": {
            const data = await callInternal({ method: "GET", path: "/mcp/knowledge-bases", apiKey });
            return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
          }
          case "create": {
            if (!params.name) {
              return {
                content: [{ type: "text", text: "Error: name is required for create" }],
                isError: true,
              };
            }
            const data = await callInternal({
              method: "POST",
              path: "/mcp/knowledge-bases",
              apiKey,
              body: {
                name: params.name,
                description: params.description,
                kb_type: params.kb_type ?? "general",
                workspace_id: params.workspace_id,
              },
            });
            return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
          }
          case "update": {
            if (!params.knowledge_base_id) {
              return {
                content: [{ type: "text", text: "Error: knowledge_base_id is required for update" }],
                isError: true,
              };
            }
            const data = await callInternal({
              method: "PATCH",
              path: `/mcp/knowledge-bases/${params.knowledge_base_id}`,
              apiKey,
              body: { name: params.name, description: params.description },
            });
            return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
          }
        }
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}

// Build a fresh McpServer wired with the instructions + tools, scoped to a
// single API key. Used by every MCP transport handler.
export function createCntxtServer(apiKey: string): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: MCP_INSTRUCTIONS }
  );
  registerTools(server, apiKey);
  return server;
}
