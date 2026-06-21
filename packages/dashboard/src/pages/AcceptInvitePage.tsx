import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  SignInButton,
  SignUpButton,
  useAuth,
  useUser,
} from "@clerk/clerk-react";
import { Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { useFetch } from "../hooks/useFetch";
import type { InvitePreview } from "../lib/types";
import { ErrorState } from "../components/common/ErrorState";
import { Skeleton } from "../components/common/LoadingSkeleton";
import { AUTH_BYPASS_ENABLED } from "../lib/constants";

const PENDING_KEY = "cntxt-pending-invite";

export function AcceptInvitePage() {
  const params = useParams();
  const navigate = useNavigate();
  const token = params.token ?? "";

  // In auth bypass mode, treat the user as signed in so dev can flow through
  // the page without Clerk configured.
  const auth = useSafeAuth();
  const isLoaded = auth.isLoaded;
  const isSignedIn = auth.isSignedIn;

  const { data, loading, error, refetch } = useFetch<InvitePreview>(
    (signal) => api.team.previewInvite(token, signal),
    [token]
  );
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const autoAcceptedRef = useRef(false);

  const accept = async () => {
    setAccepting(true);
    setAcceptError(null);
    try {
      const result = await api.team.acceptInvite(token);
      sessionStorage.removeItem(PENDING_KEY);
      navigate(`/workspace/${result.workspace_id}`, { replace: true });
    } catch (err) {
      setAcceptError(err instanceof Error ? err.message : String(err));
      setAccepting(false);
    }
  };

  // If the user just signed in/up from this page, auto-accept the invite so
  // they don't have to click again.
  useEffect(() => {
    if (autoAcceptedRef.current) return;
    if (!isLoaded || !isSignedIn) return;
    if (!data || data.accepted || data.expired) return;
    if (sessionStorage.getItem(PENDING_KEY) !== token) return;
    autoAcceptedRef.current = true;
    void accept();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, data, token]);

  const markPendingAndAuth = () => {
    sessionStorage.setItem(PENDING_KEY, token);
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-cream-50 p-6">
      <div className="w-full max-w-md">
        <div
          className="rounded-xl border bg-white p-6"
          style={{ borderColor: "rgba(67,55,39,0.12)" }}
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
            Workspace invite
          </div>

          {(loading || !isLoaded) && (
            <div className="mt-3 flex flex-col gap-2">
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="h-4 w-full" />
            </div>
          )}

          {error && !loading && (
            <ErrorState message={error} onRetry={refetch} />
          )}

          {data && !loading && data.accepted && (
            <>
              <h1 className="mt-2 text-xl font-semibold text-ink-900">
                You're already a member
              </h1>
              <p className="mt-1 text-[13px] text-ink-600">
                You're already a member of {data.workspace?.name ?? "this workspace"}.
              </p>
              {isSignedIn && (
                <button
                  onClick={() => navigate("/", { replace: true })}
                  className="mt-4 rounded-md bg-ink-800 px-3 py-1.5 text-[13px] font-medium text-cream-50"
                >
                  Open dashboard
                </button>
              )}
            </>
          )}

          {data && !loading && data.expired && !data.accepted && (
            <>
              <h1 className="mt-2 text-xl font-semibold text-ink-900">
                This invite has expired
              </h1>
              <p className="mt-1 text-[13px] text-ink-600">
                Ask the workspace owner to send you a fresh invite.
              </p>
            </>
          )}

          {data && !loading && !data.expired && !data.accepted && (
            <>
              <h1 className="mt-2 text-xl font-semibold text-ink-900">
                {isSignedIn ? "Join " : "You've been invited to "}
                {data.workspace?.name ?? "this workspace"}
              </h1>
              {data.workspace?.description && (
                <p className="mt-1 text-[13px] text-ink-600">
                  {data.workspace.description}
                </p>
              )}
              <div className="mt-3 text-[12.5px] text-ink-500">
                Invited as{" "}
                <span className="font-medium text-ink-800">{data.role}</span>
                {" · "}
                {data.email}
              </div>

              {isLoaded && !isSignedIn && (
                <>
                  <p className="mt-4 text-[13px] leading-relaxed text-ink-600">
                    Sign in or create an account to accept this invite.
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    <SignInButton mode="modal" forceRedirectUrl={`/invite/${token}`}>
                      <button
                        onClick={markPendingAndAuth}
                        className="w-full rounded-md bg-ink-800 px-3 py-2 text-[13px] font-medium text-cream-50"
                      >
                        Sign in
                      </button>
                    </SignInButton>
                    <SignUpButton mode="modal" forceRedirectUrl={`/invite/${token}`}>
                      <button
                        onClick={markPendingAndAuth}
                        className="w-full rounded-md border border-[rgba(67,55,39,0.18)] bg-white px-3 py-2 text-[13px] font-medium text-ink-800 hover:bg-cream-100"
                      >
                        Create account
                      </button>
                    </SignUpButton>
                  </div>
                </>
              )}

              {isLoaded && isSignedIn && (
                <>
                  {acceptError && (
                    <div className="mt-3 text-[12px] text-[#b04545]">
                      {acceptError}
                    </div>
                  )}
                  <button
                    onClick={accept}
                    disabled={accepting}
                    className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-md bg-ink-800 px-3 py-2 text-[13px] font-medium text-cream-50 disabled:opacity-50"
                  >
                    {accepting && (
                      <Loader2 size={14} className="animate-spin" />
                    )}
                    Accept invite
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Wraps `useUser`/`useAuth` so the page works when Clerk is bypassed in dev.
 * In bypass mode there is no ClerkProvider, so calling Clerk hooks would
 * throw — fall back to a "signed-in dev user" instead.
 */
function useSafeAuth(): { isLoaded: boolean; isSignedIn: boolean } {
  if (AUTH_BYPASS_ENABLED) {
    return { isLoaded: true, isSignedIn: true };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { isLoaded } = useUser();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { isSignedIn } = useAuth();
  return {
    isLoaded,
    isSignedIn: !!isSignedIn,
  };
}
