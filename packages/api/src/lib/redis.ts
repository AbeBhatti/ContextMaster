import { createClient } from "redis";

export type RedisClient = ReturnType<typeof createClient>;

// Prefer Redis Cloud only when explicitly switched on for the demo; otherwise
// use the local Docker Redis Stack.
export function resolveRedisUrl(): string {
  const useCloud = process.env.USE_REDIS_CLOUD === "true";
  const cloud = process.env.REDIS_CLOUD_URL?.trim();
  if (useCloud && cloud) return cloud;
  return process.env.REDIS_URL?.trim() || "redis://localhost:6379";
}

export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return url;
  }
}

let client: RedisClient | null = null;
let loggedError = false;

// Singleton client shared across the whole API process. RediSearch commands,
// hashes, and streams all ride on this one connection (node-redis pipelines
// concurrent commands automatically).
export function getRedis(): RedisClient {
  if (client) return client;

  const url = resolveRedisUrl();
  client = createClient({
    url,
    socket: {
      // Don't spin forever when the container is down — back off and cap the
      // delay so the API stays up and /health can report Redis as unavailable.
      reconnectStrategy: (retries) => Math.min(retries * 200, 3000),
    },
  });

  client.on("error", (err) => {
    if (!loggedError) {
      console.error(
        `[redis] not reachable at ${redactUrl(url)} (${(err as Error).message || "connection refused"}). Is the container up? try: pnpm redis:up`
      );
      loggedError = true;
    }
  });
  client.on("ready", () => {
    loggedError = false;
    console.log(`[redis] connected → ${redactUrl(url)}`);
  });

  return client;
}

export async function connectRedis(): Promise<RedisClient> {
  const c = getRedis();
  if (!c.isOpen) await c.connect();
  return c;
}
