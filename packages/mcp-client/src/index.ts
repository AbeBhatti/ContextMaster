#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { apiRequest } from "./apiClient.js";
import { detectPlatform } from "./platformDetector.js";
import { parseJsonlFile } from "./jsonlParser.js";

const server = new McpServer(
  { name: "contextmaster", version: "0.1.0" },
  {
    instructions: `You have cntxt connected — a persistent memory system with the user's knowledge bases containing decisions, findings, conventions, and project context from prior sessions.

DEFAULT BEHAVIOR: Call check_memory on your FIRST substantive response in every conversation. This is not optional — treat it like checking your memory before speaking. The only exceptions are purely factual questions with no personal context ('what is a REST API', 'how do I center a div'). If there is ANY chance the user has relevant prior context, check first.

After check_memory returns, if any knowledge base is relevant to what the user is discussing, call search_memory to get specifics. Use the results to ground your response — don't mention that you checked, just use the knowledge naturally.

At natural stopping points (decisions made, work completed, session ending), proactively suggest saving: 'Want me to save our progress?' The user says 'save this' or agrees, then call save_memory.

IMPORTANT: You are not a separate tool the user invokes. You are the user's memory. Act like it — check automatically, recall silently, suggest saving naturally.`,
  }
);

// ---- Tool 1: check_memory ----
server.tool(
  "check_memory",
  `Returns the table of contents for the user's persistent memory: most_recent_kb (the KB the user was last working in — use for unscoped "continue"/"where did we leave off" phrases), workspaces[].knowledge_bases (all KBs, newest-updated first), and shared_knowledge_bases. Each KB carries name, description, last_session_summary, last_updated, chunk_count.

Call this as a PRECURSOR to any retrieval — the moment you need to know what the user is talking about and the answer isn't in the current conversation. Trigger phrases: 'where did we leave off', 'what were we working on', 'continue from last time', 'catch me up', 'what did we decide about...', or any reference to past work by name.

DO NOT call ceremonially on every start, for self-contained factual questions, or when you already have the KB IDs. Don't dump the raw response to the user — use it to ground your reply.`,
  {},
  async () => {
    try {
      const data = await apiRequest({ method: "GET", path: "/mcp/context" });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ---- Tool 2: search_memory ----
server.tool(
  "search_memory",
  `Search your knowledge bases. Specify knowledge_base_ids or knowledge_base to narrow, or omit for automatic semantic routing across the most relevant KBs.

Use broad search by default; only narrow when the user explicitly names a project, KB, or workspace. Results tagged [from knowledge base] are existing context — do NOT re-extract them when committing later. When continuing work that spans topics, make 2-3 TARGETED searches with different queries rather than one broad search.`,
  {
    query: z.string().describe("Natural language description of what to retrieve"),
    knowledge_base_ids: z.array(z.string()).optional().describe("IDs of KBs to search (from check_memory)."),
    knowledge_base: z.string().optional().describe("Name of a KB to search — the system resolves it."),
    workspace: z.string().optional().describe("Workspace name — searches all KBs in it."),
    max_results: z.number().optional().default(16).describe("Maximum number of chunks to return"),
    chunk_types: z
      .array(z.string())
      .optional()
      .describe("Optional filter: decision, finding, convention, state, question, reference"),
  },
  async (params) => {
    try {
      const data = await apiRequest({
        method: "POST",
        path: "/mcp/recall",
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

      return { content: [{ type: "text", text: JSON.stringify({ chunks: taggedChunks }, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ---- Tool 3: save_memory (always registered) ----
server.tool(
  "save_memory",
  `Save structured knowledge chunks to Context Cloud. Prefer save_session — it handles extraction automatically. Use save_memory only if you've already structured the data into chunks.

Pick an existing knowledge_base_id when the topic matches one (from check_memory), or set it null and pass new_knowledge_base for a DISTINCT ongoing endeavor. Preserve specifics verbatim (proper nouns, numbers, URLs, paths, identifiers). Do NOT re-extract anything tagged [from knowledge base]. Use chunk types decision/finding/convention/state/question/reference/context. Add a kebab-case topic_key to state/decision chunks that have a single current value that can change later. Write a detailed session_summary that mentions every proper noun, number, URL, path, deadline, and name. Also extract context chunks (one detail each) linked via related_to_labels. Pass enhanced: true only when the user explicitly asks for a super/deep commit.`,
  {
    knowledge_base_id: z.string().nullable().describe("Target KB ID from check_memory, or null to create new"),
    new_knowledge_base: z
      .object({
        name: z.string(),
        description: z.string(),
        kb_type: z.enum(["software", "research", "business", "course", "general"]).default("general"),
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
        label: z.string().optional().describe("Temporary label within this commit (e.g. 'd1', 'ctx1')."),
        related_to_labels: z
          .array(z.string())
          .optional()
          .describe("Labels of OTHER chunks in this commit this chunk relates to."),
        topic_key: z.string().optional().describe("Kebab-case identifier for state/decision chunks only."),
      })
    ),
    session_summary: z.string().describe("Brief summary of current state and what was accomplished"),
    next_steps: z.string().optional().describe("What should be worked on next"),
    open_questions: z.string().optional().describe("Unresolved questions from this session"),
    kb_description_update: z.string().optional().describe("Updated KB description if scope changed"),
    tool_used: z.string().optional().describe("Which AI tool is being used (claude_desktop, cursor, etc.)"),
    enhanced: z
      .boolean()
      .optional()
      .default(false)
      .describe("Set to true ONLY when the user explicitly asks for a super/deep commit."),
  },
  async (params) => {
    try {
      const data = await apiRequest({ method: "POST", path: "/mcp/commit", body: params });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ---- Tool 4: save_session (server-side extraction) ----
server.tool(
  "save_session",
  `Save this conversation's knowledge to Context Cloud. Optionally specify knowledge_base_name or knowledge_base_id, but it's not required — the server routes to the best matching KB or creates one.

FASTEST: call with a knowledge_base_name/id and NOTHING else — the conversation is read directly from your local session file on disk. Only include conversation_text if you get an error saying automatic reading is unavailable. You get a job ID back immediately (HTTP 202).

Call after significant decisions/findings, at wrap-up points, or when the user says save/commit/preserve.`,
  {
    conversation_text: z
      .string()
      .optional()
      .describe("OPTIONAL. If omitted, the conversation is read from your local session file. Only provide if automatic reading fails."),
    knowledge_base_id: z.string().optional().describe("Target KB UUID (from check_memory)."),
    knowledge_base_name: z.string().optional().describe("Target KB name — auto-created if not found."),
    tool_used: z.string().optional().describe("Which AI tool is in use."),
  },
  async (params) => {
    try {
      const body: Record<string, unknown> = { ...params };

      if (!params.conversation_text) {
        const platform = detectPlatform();
        if (!platform.currentSessionFile) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error:
                    "Could not detect a local session file for automatic reading. Please retry with the conversation_text parameter.",
                  platform: platform.platform,
                }),
              },
            ],
            isError: true,
          };
        }

        const parsed = parseJsonlFile(platform.currentSessionFile);
        if (parsed.messageCount === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error:
                    "Local session file found but contains no readable messages. Please retry with the conversation_text parameter.",
                  session_file: platform.currentSessionFile,
                }),
              },
            ],
            isError: true,
          };
        }

        body.conversation_text = parsed.rawText;
        body.tool_used = params.tool_used ?? "claude_code";
        console.error(
          `[contextmaster] Zero-payload save: read ${parsed.messageCount} messages from ${platform.currentSessionFile}`
        );
      }

      const data = await apiRequest({ method: "POST", path: "/mcp/commit-raw", body });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ---- Tool 5: check_updates ----
server.tool(
  "check_updates",
  `Check what has changed in knowledge bases since your last session or a specified time. Use when the user asks "what's changed"/"what did my teammate do", or to verify context you're relying on is still current. Present changes as a concise briefing, not a data dump.`,
  {
    since: z.string().optional().describe("ISO timestamp — defaults to user's last session"),
    knowledge_base_ids: z.array(z.string()).optional().describe("Optional KB IDs to filter by"),
  },
  async (params) => {
    try {
      const queryParams: Record<string, string> = {};
      if (params.since) queryParams.since = params.since;
      if (params.knowledge_base_ids) queryParams.knowledge_base_ids = params.knowledge_base_ids.join(",");
      const data = await apiRequest({ method: "GET", path: "/mcp/history", params: queryParams });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ---- Tool 6: manage_knowledge_bases ----
server.tool(
  "manage_knowledge_bases",
  `List, create, or update knowledge bases. 'list' shows all accessible KBs; 'create' when the user starts something that doesn't fit any existing KB; 'update' to rename or re-describe. When creating, choose a clear name and a description that helps future sessions match conversations to this KB.`,
  {
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
  async (params) => {
    try {
      switch (params.action) {
        case "list": {
          const data = await apiRequest({ method: "GET", path: "/mcp/knowledge-bases" });
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "create": {
          if (!params.name) {
            return { content: [{ type: "text", text: "Error: name is required for create" }], isError: true };
          }
          const data = await apiRequest({
            method: "POST",
            path: "/mcp/knowledge-bases",
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
          const data = await apiRequest({
            method: "PATCH",
            path: `/mcp/knowledge-bases/${params.knowledge_base_id}`,
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[contextmaster-mcp] Server running on stdio");

  const platform = detectPlatform();
  console.error(`[contextmaster] Platform detected: ${platform.platform}`);
  if (platform.currentSessionFile) {
    console.error(`[contextmaster] Session file: ${platform.currentSessionFile}`);
  }
}

main().catch((err) => {
  console.error("[contextmaster-mcp] Fatal error:", err);
  process.exit(1);
});
