import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@clerk/clerk-react";
import { API_URL } from "../lib/constants";

type Status = "loading" | "redirecting" | "error";

export function OAuthAuthorizePage() {
  const [params] = useSearchParams();
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || inFlight.current) return;
    inFlight.current = true;

    const run = async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("Could not obtain Clerk session token");

        const payload = {
          client_id: params.get("client_id"),
          redirect_uri: params.get("redirect_uri"),
          state: params.get("state") ?? undefined,
          scope: params.get("scope") ?? "mcp",
          code_challenge: params.get("code_challenge") ?? undefined,
          code_challenge_method:
            params.get("code_challenge_method") ?? undefined,
        };

        if (!payload.client_id || !payload.redirect_uri) {
          throw new Error("Missing client_id or redirect_uri");
        }

        const res = await fetch(`${API_URL}/oauth/authorize/callback`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const text = await res.text();
          let message = `Authorization failed (${res.status})`;
          try {
            const body = JSON.parse(text) as {
              error?: string;
              error_description?: string;
            };
            message =
              body.error_description ?? body.error ?? message;
          } catch {
            if (text) message = text;
          }
          throw new Error(message);
        }

        const data = (await res.json()) as { redirect_url?: string };
        if (!data.redirect_url) {
          throw new Error("Server did not return a redirect_url");
        }

        setStatus("redirecting");
        window.location.replace(data.redirect_url);
      } catch (err) {
        inFlight.current = false;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    };

    void run();
  }, [isLoaded, isSignedIn, getToken, params]);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-cream-50 p-6">
      <div
        className="w-full max-w-md rounded-xl border bg-white p-6"
        style={{ borderColor: "rgba(67,55,39,0.12)" }}
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
          Authorize connector
        </div>
        {status === "error" ? (
          <>
            <h1 className="mt-2 text-xl font-semibold text-ink-900">
              Authorization failed
            </h1>
            <p className="mt-2 text-[13px] text-ink-600">
              {error ?? "Something went wrong. You can close this window and try again."}
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-2 text-xl font-semibold text-ink-900">
              {status === "redirecting"
                ? "Sending you back…"
                : "Connecting your account…"}
            </h1>
            <div className="mt-4 flex items-center gap-2 text-[13px] text-ink-600">
              <Loader2 size={14} className="animate-spin" />
              <span>One moment</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
