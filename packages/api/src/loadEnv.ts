import { config, parse } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));

// Walk up until we find the ContextMaster/.env (works for both src and dist).
const candidates = [
  resolve(here, "../.env"),
  resolve(here, "../../.env"),
  resolve(here, "../../../.env"),
  resolve(here, "../../../../.env"),
];

let loadedPath: string | undefined;
let parsed: Record<string, string> = {};
for (const path of candidates) {
  if (existsSync(path)) {
    parsed = parse(readFileSync(path));
    // override: true makes our .env authoritative. Without it, a globally
    // exported shell var (e.g. an NVIDIA OPENAI_API_KEY / OPENAI_BASE_URL set
    // for another project) would silently win and break OpenAI calls.
    config({ path, override: true });
    loadedPath = path;
    break;
  }
}

// The OpenAI SDK auto-reads OPENAI_BASE_URL from the environment. If our .env
// doesn't set it, drop any ambient value so the SDK falls back to the real
// OpenAI endpoint instead of an unrelated OpenAI-compatible gateway.
if (loadedPath && !parsed.OPENAI_BASE_URL) {
  delete process.env.OPENAI_BASE_URL;
}
