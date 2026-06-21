import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight, ExternalLink, HelpCircle, LogOut, Sparkles, UserCog } from "lucide-react";
import { useClerk, useUser as useClerkUser } from "@clerk/clerk-react";
import { useDashboard } from "../components/layout/DashboardLayout";
import { MCPConfig } from "../components/settings/MCPConfig";
import { APIKeyManager } from "../components/settings/APIKeyManager";
import { AUTH_BYPASS_ENABLED } from "../lib/constants";
import type { User } from "../lib/types";

export function SettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useDashboard();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (location.hash !== "#api-keys") return;
    setAdvancedOpen(true);
    requestAnimationFrame(() => {
      const el = document.getElementById("api-keys");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [location.hash]);

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 pt-5">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 hover:bg-cream-200"
            title="Back"
          >
            <ArrowLeft size={14} />
          </button>
          <div className="text-[18px] font-semibold text-ink-900">
            Account settings
          </div>
          <button
            onClick={() => navigate("/help")}
            className="ml-auto flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1.5 text-[12px] font-medium text-ink-700 hover:bg-cream-100"
            style={{ borderColor: "rgba(24,24,27,0.18)" }}
          >
            <HelpCircle size={12} /> Help
          </button>
        </div>

        {AUTH_BYPASS_ENABLED ? (
          <BypassAccountSection user={user} />
        ) : (
          <ClerkAccountSection user={user} />
        )}

        <PlanSection />

        <section
          className="rounded-[10px] border bg-white p-4"
          style={{ borderColor: "rgba(24,24,27,0.10)" }}
        >
          <MCPConfig />
        </section>

        <section
          id="api-keys"
          className="rounded-[10px] border bg-white"
          style={{ borderColor: "rgba(24,24,27,0.10)" }}
        >
          <button
            onClick={() => setAdvancedOpen((o) => !o)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left"
          >
            <ChevronRight
              size={13}
              className="transition-transform"
              style={{
                transform: advancedOpen ? "rotate(90deg)" : "rotate(0deg)",
              }}
            />
            <span className="text-[13px] font-semibold text-ink-800">
              Developer / Advanced
            </span>
            <span className="text-[11.5px] font-normal text-ink-500">
              · API keys
            </span>
          </button>
          {advancedOpen && (
            <div
              className="border-t px-4 py-4"
              style={{ borderColor: "rgba(24,24,27,0.10)" }}
            >
              <APIKeyManager />
            </div>
          )}
        </section>

        <div className="mt-2 text-center text-[11.5px] text-ink-500">
          <a
            href="/privacy"
            className="transition-colors hover:text-ink-700"
          >
            Privacy Policy
          </a>
        </div>
      </div>
    </div>
  );
}

function PlanSection() {
  return (
    <section
      className="overflow-hidden rounded-[10px] border bg-white"
      style={{ borderColor: "rgba(24,24,27,0.10)" }}
    >
      <div className="flex items-center justify-between gap-4 px-4 py-4">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink-800">Plan</div>
          <div className="mt-1 text-[12px] text-ink-500">
            You currently have access to all features. Paid plans coming soon.
          </div>
        </div>
        <span
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{
            background: "rgba(61,90,128,0.18)",
            color: "#3d5a80",
          }}
        >
          <Sparkles size={11} />
          Early Access — Full Access
        </span>
      </div>
    </section>
  );
}

function ClerkAccountSection({ user }: { user: User | null }) {
  const clerk = useClerk();
  const clerkUserQ = useClerkUser();
  const [signingOut, setSigningOut] = useState(false);

  const clerkUser = clerkUserQ.user;
  const displayName =
    clerkUser?.fullName ?? user?.name ?? user?.email ?? "Account";
  const email =
    clerkUser?.primaryEmailAddress?.emailAddress ?? user?.email ?? "";
  const avatarUrl = clerkUser?.imageUrl;
  const initial = (displayName ?? email)[0]?.toUpperCase() ?? "?";

  const onSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await clerk.signOut();
    } catch {
      setSigningOut(false);
    }
  };

  const onSwitchAccounts = () => {
    if (clerk.openUserProfile) {
      clerk.openUserProfile();
    } else {
      window.location.href = "https://accounts.contextcloud.pro";
    }
  };

  return (
    <section
      className="flex flex-col gap-4 rounded-[10px] border bg-white p-4"
      style={{ borderColor: "rgba(24,24,27,0.10)" }}
    >
      <div className="flex items-center gap-3">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="h-12 w-12 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gold-400 text-[16px] font-bold text-cream-50">
            {initial}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-ink-900">
            {displayName}
          </div>
          {email && (
            <div className="truncate text-[12px] text-ink-500">{email}</div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onSwitchAccounts}
          className="flex items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-[12.5px] font-medium text-ink-800"
          style={{ borderColor: "rgba(24,24,27,0.18)" }}
        >
          <UserCog size={12} /> Manage / switch account
          <ExternalLink size={11} className="ml-0.5 text-ink-500" />
        </button>
        <button
          onClick={onSignOut}
          disabled={signingOut}
          className="flex items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-[12.5px] font-medium text-danger disabled:opacity-60"
          style={{ borderColor: "rgba(220,38,38,0.4)" }}
        >
          <LogOut size={12} /> {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </section>
  );
}

function BypassAccountSection({ user }: { user: User | null }) {
  const displayName = user?.name ?? user?.email ?? "Account";
  const email = user?.email ?? "";
  const initial = displayName[0]?.toUpperCase() ?? "?";

  return (
    <section
      className="flex flex-col gap-4 rounded-[10px] border bg-white p-4"
      style={{ borderColor: "rgba(24,24,27,0.10)" }}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gold-400 text-[16px] font-bold text-cream-50">
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-ink-900">
            {displayName}
          </div>
          {email && (
            <div className="truncate text-[12px] text-ink-500">{email}</div>
          )}
        </div>
      </div>
      <div className="text-[12px] text-ink-500">
        Auth bypass is enabled — sign-out and account switching are disabled in
        development.
      </div>
    </section>
  );
}
