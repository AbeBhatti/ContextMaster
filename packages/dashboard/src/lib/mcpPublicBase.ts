/** Public HTTPS base for MCP URLs shown in onboarding and help (not localhost API). */
export function getPublicMcpApiBase(): string {
  const raw =
    (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ??
    "";
  if (
    /^https:\/\//i.test(raw) &&
    !/localhost|127\.0\.0\.1/i.test(raw)
  ) {
    return raw;
  }
  return "https://api.contextcloud.pro";
}
