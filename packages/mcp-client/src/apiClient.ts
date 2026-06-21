// Thin HTTP client for the ContextMaster API. The stdio MCP server forwards
// every tool call here with the user's API key. Defaults target the local dev
// API; override CNTXT_API_URL / CNTXT_API_KEY for other environments.

const API_URL = process.env.CNTXT_API_URL ?? "http://localhost:3001";
const API_KEY = process.env.CNTXT_API_KEY || "cm_dev_local_key";

if (!process.env.CNTXT_API_KEY) {
  console.error("[contextmaster] CNTXT_API_KEY not set — using local dev key 'cm_dev_local_key'");
}

interface RequestOptions {
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
  params?: Record<string, string>;
}

export async function apiRequest<T = any>(options: RequestOptions): Promise<T> {
  const { method, path, body, params } = options;

  let url = `${API_URL}${path}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `API request failed: ${response.status} ${response.statusText} — ${errorBody}`
    );
  }

  return response.json() as Promise<T>;
}
