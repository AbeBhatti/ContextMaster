import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  HelpCircle,
  Loader2,
  MessageSquare,
  Terminal,
} from "lucide-react";
import { api } from "../lib/api";
import { useUser } from "../hooks/useUser";
import { useWorkspaces } from "../hooks/useWorkspaces";
import type { WorkspaceSummary } from "../lib/types";
import type { OnboardingToolId } from "../components/onboarding/ToolSetupInstructions";
import { OnboardingConnectStep } from "../components/onboarding/OnboardingConnectStep";
import { track } from "../lib/analytics";

import logoUrl from "@onboarding-assets/cntxtLogo.svg?url";

const STARTER_PROMPT = `Check my Getting Started knowledge base from ContextMaster — walk me through how ContextMaster works, what tools I can call, and how to save and retrieve context in my workspaces.`;

function ProgressDots({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center gap-1.5">
      {([1, 2, 3] as const).map((i) => {
        const active = i === step;
        return (
          <div
            key={i}
            className="h-1.5 rounded-full transition-all"
            style={{
              width: active ? 18 : 6,
              background: active ? "#3d5a80" : "rgba(61,90,128,0.22)",
            }}
          />
        );
      })}
    </div>
  );
}

function DownArrow({ stroke }: { stroke: string }) {
  return (
    <svg
      width="32"
      height="26"
      viewBox="0 0 32 26"
      fill="none"
      aria-hidden
    >
      <path
        d="M16 2 L16 20"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M16 20 L12 16 M16 20 L20 16"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ExamplePhraseCard({
  phrase,
  leftLabel,
  rightLabel,
  leftColor,
  rightColor,
}: {
  phrase: string;
  leftLabel: string;
  rightLabel: string;
  leftColor: string;
  rightColor: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-center text-sm font-medium text-gray-800">{phrase}</p>
      <div className="mt-3 flex justify-around gap-2">
        <div className="flex flex-col items-center gap-1">
          <DownArrow stroke={leftColor} />
          <span className="text-xs font-medium" style={{ color: leftColor }}>
            {leftLabel}
          </span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <DownArrow stroke={rightColor} />
          <span className="text-xs font-medium" style={{ color: rightColor }}>
            {rightLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

export function ONBOARDING_KEY(userId: string | null | undefined): string {
  return `cntxt:onboarding:completed:${userId ?? "anon"}`;
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const userQ = useUser();
  const workspacesQ = useWorkspaces();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedTool, setSelectedTool] = useState<OnboardingToolId | null>(
    null
  );
  const [activeClaudeTab, setActiveClaudeTab] = useState<"desktop" | "cli">(
    "desktop"
  );
  const [activeCodexTab, setActiveCodexTab] = useState<"desktop" | "cli">(
    "desktop"
  );
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [createdWorkspace, setCreatedWorkspace] =
    useState<WorkspaceSummary | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const userName = userQ.data?.name?.split(" ")[0] ?? "";

  useEffect(() => {
    track("onboarding.started");
  }, []);

  useEffect(() => {
    if (workspacesQ.loading) return;
    if (creatingWorkspace || createdWorkspace) return;
    const existing = workspacesQ.data ?? [];
    if (existing.length > 0) {
      setCreatedWorkspace(existing[0]);
      return;
    }
    setCreatingWorkspace(true);
    api.workspaces
      .create({ name: "General" })
      .then((ws) => {
        const summary: WorkspaceSummary = {
          ...ws,
          organization_id: ws.organization_id ?? null,
          kb_count: 0,
          chunk_count: 0,
          last_updated: ws.updated_at,
          members: [],
          role: "owner",
        };
        setCreatedWorkspace(summary);
        workspacesQ.setData([summary]);
      })
      .catch((err) => {
        setCreateError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setCreatingWorkspace(false));
  }, [workspacesQ.loading, workspacesQ.data, creatingWorkspace, createdWorkspace, workspacesQ]);

  const finish = useCallback(() => {
    const userId = userQ.data?.id;
    try {
      window.localStorage.setItem(ONBOARDING_KEY(userId), "1");
    } catch {
      // ignore
    }
    track("onboarding.completed", { tool: selectedTool ?? null });
    if (createdWorkspace) {
      navigate(`/workspace/${createdWorkspace.id}`, { replace: true });
    } else {
      navigate("/", { replace: true });
    }
  }, [userQ.data?.id, selectedTool, createdWorkspace, navigate]);

  const goNextFromWelcome = () => setStep(2);

  const goNextFromConnect = () => setStep(3);

  const goBack = () => {
    setActiveClaudeTab("desktop");
    setActiveCodexTab("desktop");
    if (step === 2 && selectedTool) {
      setSelectedTool(null);
      return;
    }
    if (step === 2) {
      setStep(1);
      return;
    }
    if (step === 3) {
      setStep(2);
    }
  };

  const onSelectTool = (id: OnboardingToolId | null) => {
    if (id !== null) {
      setActiveClaudeTab("desktop");
      setActiveCodexTab("desktop");
    }
    setSelectedTool(id);
  };

  const runStarterPrompt = async () => {
    try {
      await navigator.clipboard.writeText(STARTER_PROMPT);
      setCopiedPrompt(true);
      window.setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {
      // clipboard unavailable
    }
    const a = document.createElement("a");
    a.href = "https://claude.ai/new";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  };

  const backDisabled = step === 1;
  const actionColor = "#3d5a80";
  const kbColor = "#3d5a80";

  return (
    <div
      className="flex h-screen w-screen flex-col"
      style={{ background: "#fafbfc" }}
    >
      <header className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-2.5">
          <img
            src={logoUrl}
            alt=""
            className="h-7 w-7 object-contain"
          />
          <span className="text-[13px] font-semibold text-gray-900">ContextMaster</span>
        </div>
        <ProgressDots step={step} />
        <button
          type="button"
          onClick={finish}
          className="text-[12px] text-gray-600 hover:text-gray-900"
        >
          Skip onboarding
        </button>
      </header>

      <main className="flex-1 overflow-y-auto">
        {step === 1 && (
          <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center px-6 py-12">
            <div className="flex flex-col gap-5 text-center">
              <h1 className="text-[26px] font-semibold tracking-tight text-gray-900">
                Welcome{userName ? `, ${userName}` : ""} — Your AI&apos;s Memory
              </h1>
              <p className="text-[15px] leading-relaxed text-gray-600">
                Carry decisions, findings, and progress across every conversation.
                Save when it matters — your AI picks up right where you left off.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={goNextFromWelcome}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  Let&apos;s get you set up <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}
        {step === 2 && (
          <OnboardingConnectStep
            selectedTool={selectedTool}
            onSelect={onSelectTool}
            activeClaudeTab={activeClaudeTab}
            setActiveClaudeTab={setActiveClaudeTab}
            activeCodexTab={activeCodexTab}
            setActiveCodexTab={setActiveCodexTab}
            onContinue={goNextFromConnect}
            onSkip={goNextFromConnect}
          />
        )}
        {step === 3 && (
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-10">
            <div className="text-center">
              <h1 className="text-[26px] font-semibold tracking-tight text-gray-900">
                Get Started Now
              </h1>
              <p className="mt-2 text-[15px] leading-relaxed text-gray-600">
                You&apos;re all set — here&apos;s how to make the most of
                ContextMaster.
              </p>
            </div>

            <div
              className="rounded-xl p-6 text-white"
              style={{ background: "#3d5a80" }}
            >
              <div className="flex items-start gap-3">
                <MessageSquare className="mt-0.5 h-5 w-5 shrink-0 opacity-90" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    Click, paste in your chat box — it&apos;s your onboarding guide
                  </p>
                  <p className="mt-3 text-sm italic leading-relaxed text-white/95">
                    &ldquo;{STARTER_PROMPT}&rdquo;
                  </p>
                  <div className="my-4 h-px bg-white/20" />
                  <p className="text-xs leading-relaxed text-white/60">
                    This prompt activates your Getting Started knowledge base inside
                    ContextMaster. It will walk you through every feature, show you
                    which tools to call, and teach you how to save and retrieve
                    context across your workspaces — all from inside your AI.
                  </p>
                  <button
                    type="button"
                    onClick={runStarterPrompt}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-gray-100"
                  >
                    Run this prompt
                  </button>
                  {copiedPrompt && (
                    <p className="mt-2 text-xs text-white/70">
                      Copied to clipboard
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <Terminal className="h-4 w-4 text-gray-700" />
                Prompting with ContextMaster
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-center text-lg font-medium">
                <span
                  className="rounded px-2 py-1"
                  style={{
                    background: "rgba(61, 90, 128, 0.1)",
                    color: "#3d5a80",
                  }}
                >
                  [action]
                </span>
                <span className="text-gray-400">+</span>
                <span
                  className="rounded px-2 py-1"
                  style={{
                    background: "rgba(61, 90, 128, 0.1)",
                    color: "#3d5a80",
                  }}
                >
                  [KB/workspace]
                </span>
                <span className="text-gray-400">+</span>
                <span className="rounded bg-gray-100 px-2 py-1 text-gray-600">
                  ContextMaster
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ExamplePhraseCard
                phrase='"pull sustainable packaging from ContextMaster"'
                leftLabel="action"
                rightLabel="KB/workspace"
                leftColor={actionColor}
                rightColor={kbColor}
              />
              <ExamplePhraseCard
                phrase='"save this to Science Fair Project using ContextMaster"'
                leftLabel="action"
                rightLabel="KB/workspace"
                leftColor={actionColor}
                rightColor={kbColor}
              />
              <ExamplePhraseCard
                phrase='"summarise Marketing Q3 in ContextMaster"'
                leftLabel="action"
                rightLabel="KB/workspace"
                leftColor={actionColor}
                rightColor={kbColor}
              />
              <ExamplePhraseCard
                phrase='"check my Dev Notes on ContextMaster"'
                leftLabel="action"
                rightLabel="KB/workspace"
                leftColor={actionColor}
                rightColor={kbColor}
              />
            </div>

            <div
              className="rounded-lg border px-4 py-3 text-sm leading-relaxed text-gray-700"
              style={{ background: "#f7f9fb", borderColor: "#e2e5e9" }}
            >
              Working in a specific project? Always name your workspace when you
              talk to your AI — e.g. &quot;in my Marketing Q3 workspace&quot; or
              &quot;from my Dev Notes project&quot;. ContextMaster will scope every
              save and search to exactly that workspace, so nothing bleeds between
              projects.
            </div>

            <div className="flex flex-col items-center gap-2 pb-6">
              <button
                type="button"
                onClick={finish}
                disabled={creatingWorkspace}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {creatingWorkspace ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Setting things up…
                  </>
                ) : (
                  <>
                    Go to Dashboard <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
              {createError && (
                <p className="max-w-md text-center text-xs text-red-600">
                  Couldn&apos;t create your workspace: {createError}
                </p>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="flex items-center justify-between border-t border-gray-200 px-6 py-3">
        <button
          type="button"
          onClick={goBack}
          disabled={backDisabled}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ArrowLeft size={12} /> Back
        </button>
        <div className="text-[11.5px] text-gray-500">
          Step {step} of 3
        </div>
        <button
          type="button"
          onClick={() => navigate("/help")}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-gray-700 hover:bg-gray-100"
        >
          <HelpCircle size={12} /> Having trouble?
        </button>
      </footer>
    </div>
  );
}
