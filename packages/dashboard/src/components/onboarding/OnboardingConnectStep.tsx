import { useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useApiKeys } from "../../hooks/useApiKeys";
import { api } from "../../lib/api";
import { getPublicMcpApiBase } from "../../lib/mcpPublicBase";
import type { CreatedApiKey } from "../../lib/types";
import type { OnboardingToolId } from "./ToolSetupInstructions";
import { track } from "../../lib/analytics";

import claudeImg from "@onboarding-assets/claude.png?url";
import chatgptImg from "@onboarding-assets/gpt.png?url";
import codexImg from "@onboarding-assets/codex.png?url";
import cursorImg from "@onboarding-assets/cursor.png?url";
import windsurfImg from "@onboarding-assets/windsurf.png?url";
import vscodeImg from "@onboarding-assets/vscode.svg?url";

const onboardingVideoUrls = import.meta.glob<string>(
  "@onboarding-assets/*.mp4",
  { eager: true, query: "?url", import: "default" }
) as Record<string, string>;

function videoSrc(filename: string): string | undefined {
  const hit = Object.entries(onboardingVideoUrls).find(([path]) =>
    path.endsWith(filename)
  );
  return hit?.[1];
}

const PLACEHOLDER_KEY = "YOUR_API_KEY";

const PRIMARY = "#3d5a80";
const SELECTED_BG = "#eef2f7";

const TOOLS: {
  id: OnboardingToolId;
  label: string;
  src: string;
}[] = [
  { id: "claude", label: "Claude", src: claudeImg },
  { id: "chatgpt", label: "ChatGPT", src: chatgptImg },
  { id: "codex", label: "Codex", src: codexImg },
  { id: "cursor", label: "Cursor", src: cursorImg },
  { id: "vscode", label: "Copilot", src: vscodeImg },
  { id: "windsurf", label: "Windsurf", src: windsurfImg },
];

function openExternal(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.click();
}

function CopyUrlRow({
  value,
  onCopied,
}: {
  value: string;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      onCopied?.();
      window.setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="flex items-center gap-1.5 rounded border border-gray-200 bg-gray-50 py-1.5 pl-1.5 pr-2">
      <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-tight text-gray-800">
        {value}
      </code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded p-1 text-gray-600 hover:bg-gray-200"
        aria-label="Copy URL"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-600" strokeWidth={2.5} />
        ) : (
          <Copy className="h-3.5 w-3.5" strokeWidth={2} />
        )}
      </button>
    </div>
  );
}

function CodeCopyBlock({
  value,
  onCopied,
}: {
  value: string;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      onCopied?.();
      window.setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="relative">
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded border border-gray-200 bg-gray-50 px-3 py-2 pr-10 font-mono text-xs text-gray-800">
        {value}
      </pre>
      <button
        type="button"
        onClick={copy}
        className="absolute right-2 top-2 rounded border border-gray-200 bg-white p-1 text-gray-600 hover:bg-gray-100"
        aria-label="Copy"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-600" strokeWidth={2.5} />
        ) : (
          <Copy className="h-3.5 w-3.5" strokeWidth={2} />
        )}
      </button>
    </div>
  );
}

function StepCircle({ n }: { n: number }) {
  return (
    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black text-xs font-medium text-white">
      {n}
    </span>
  );
}

function InstructionTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div
      className="mb-3 flex gap-1 border-b border-gray-200"
      role="tablist"
    >
      {tabs.map((t) => {
        const is = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={is}
            onClick={() => onChange(t.id)}
            className={`relative -mb-px px-3 py-2 text-sm font-medium transition-colors ${
              is
                ? "border-b-2 text-gray-900"
                : "border-b-2 border-transparent text-gray-500 hover:text-gray-700"
            }`}
            style={
              is ? { borderBottomColor: PRIMARY, color: PRIMARY } : undefined
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** Responsive video: scales with column width; height from aspect + viewport cap (no fixed px). */
function VideoOrPlaceholder({
  src,
  /** Default: two-up tools. `chatgpt`: ~30% taller cap, fills column width. */
  layout = "default",
}: {
  src?: string;
  layout?: "default" | "chatgpt";
}) {
  const [failed, setFailed] = useState(!src);
  const capClass =
    layout === "chatgpt"
      ? "max-h-[min(52svh,85dvh)]"
      : "max-h-[min(40svh,72dvh)]";
  const frameClass = `aspect-video w-full max-w-full object-contain ${capClass}`;

  if (!src || failed) {
    return (
      <div
        className={`flex aspect-video w-full max-w-full items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-[4%] text-center text-xs leading-snug text-gray-500 ${capClass}`}
      >
        Add matching .mp4 in repo <code className="mx-0.5 rounded bg-gray-200 px-1">imports/</code>
      </div>
    );
  }
  return (
    <video
      className={`rounded-lg border border-gray-200 bg-black shadow-sm ${frameClass}`}
      src={src}
      autoPlay
      loop
      muted
      playsInline
      onError={() => setFailed(true)}
    />
  );
}

function CodexComingSoon() {
  return (
    <div
      className="flex aspect-video w-full max-w-full max-h-[min(40svh,72dvh)] items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-xs font-medium text-gray-600"
    >
      Video coming soon
    </div>
  );
}

function ApiKeyRow({
  apiKey,
  hasExistingKey,
  generating,
  generateError,
  onGenerate,
}: {
  apiKey: string;
  hasExistingKey: boolean;
  generating: boolean;
  generateError: string | null;
  onGenerate: () => void;
}) {
  const usingPh = apiKey === PLACEHOLDER_KEY;
  return (
    <div className="mt-2 flex flex-col gap-1.5 text-xs text-gray-600">
      {usingPh && (
        <p>
          Replace <code className="rounded bg-gray-100 px-1">{PLACEHOLDER_KEY}</code>{" "}
          with your API key from Settings, or generate one:
        </p>
      )}
      <button
        type="button"
        onClick={onGenerate}
        disabled={generating}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        {generating ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        Generate API Key
      </button>
      {generateError && (
        <p className="text-red-600">{generateError}</p>
      )}
      {hasExistingKey && usingPh && (
        <p className="text-[11px]">
          You already have a key — open{" "}
          <a
            href="/settings#api-keys"
            className="font-medium underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Settings → API keys
          </a>{" "}
          to copy it into the command above.
        </p>
      )}
    </div>
  );
}

export function OnboardingConnectStep({
  selectedTool,
  onSelect,
  activeClaudeTab,
  setActiveClaudeTab,
  activeCodexTab,
  setActiveCodexTab,
  onContinue,
  onSkip,
}: {
  selectedTool: OnboardingToolId | null;
  onSelect: (id: OnboardingToolId | null) => void;
  activeClaudeTab: "desktop" | "cli";
  setActiveClaudeTab: (t: "desktop" | "cli") => void;
  activeCodexTab: "desktop" | "cli";
  setActiveCodexTab: (t: "desktop" | "cli") => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const base = useMemo(() => getPublicMcpApiBase(), []);
  const urlProtocol = `${base}/mcp/protocol`;
  const urlSse = `${base}/mcp/sse`;

  const { cursorMcpInstallLink } = useMemo(() => {
    const config = { type: "http" as const, url: urlProtocol };
    const encodedConfig = encodeURIComponent(JSON.stringify(config));
    return {
      cursorMcpInstallLink: `cursor://anysphere.cursor-deeplink/mcp/install?name=cntxt&config=${encodedConfig}`,
    };
  }, [urlProtocol]);

  const { data: keys, refetch } = useApiKeys();
  const [revealedKey, setRevealedKey] = useState<CreatedApiKey | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const activeKey = (keys ?? []).find((k) => !k.revoked_at);
  const hasExistingKey = !!activeKey;
  const apiKey = revealedKey?.key ?? PLACEHOLDER_KEY;

  const onGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const key = await api.auth.createApiKey("cntxt setup");
      setRevealedKey(key);
      refetch();
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const claudeCli = `claude mcp add --transport http cntxt ${urlProtocol} --header "Authorization: Bearer ${apiKey}" --scope user`;
  const codexCli = `codex mcp add cntxt --url ${urlProtocol}\ncodex mcp login cntxt`;
  const windsurfJson = JSON.stringify(
    {
      mcpServers: {
        cntxt: {
          command: "npx",
          args: ["@contextcloud/mcp-client"],
          env: {
            CNTXT_API_KEY: apiKey,
            CNTXT_API_URL: base,
          },
        },
      },
      version: 1,
    },
    null,
    2
  );

  const vClaudeTop = videoSrc("claudedesktoptopvideo.mp4");
  const vClaudeBot = videoSrc("claudedesktopbottomvideo.mp4");
  const vChatgpt = videoSrc("gptvideo.mp4");
  const vCopilotTop = videoSrc("copilottopvideo.mp4");
  const vCopilotBottom = videoSrc("copilotbottomvideo.mp4");

  const tipNoTool = (
    <p className="text-center text-sm text-gray-600">
      <span aria-hidden>💡</span> Say &quot;search my [project name] for...&quot;
      to find specific info
    </p>
  );

  const tipCrossTool = (
    <p className="text-center text-sm text-gray-600">
      <span aria-hidden>💡</span> Knowledge saved in one tool is available in
      all your others
    </p>
  );

  const tipChatgptVideo = (
    <p className="text-center text-sm text-gray-600">
      <span aria-hidden>💡</span> Say &quot;search my [project name] for...&quot;
      to find specific info.
    </p>
  );

  const toolGrid = (compact: boolean) => (
    <div
      className={`grid w-full max-w-3xl grid-cols-2 gap-2 sm:grid-cols-3 ${compact ? "mx-auto" : ""}`}
    >
      {TOOLS.map((t) => {
        const sel = selectedTool === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              if (selectedTool === t.id) {
                onSelect(null);
                return;
              }
              onSelect(t.id);
              track("onboarding.tool_selected", { tool: t.id });
            }}
            className={`flex flex-row items-center justify-start gap-2.5 rounded-lg border bg-white px-3 py-2.5 text-left transition-colors hover:border-gray-400 sm:gap-3 sm:px-3.5 sm:py-3 ${
              sel
                ? "border-accent"
                : "border-gray-300"
            }`}
            style={sel ? { background: SELECTED_BG } : undefined}
          >
            <img
              src={t.src}
              alt=""
              className={`shrink-0 object-contain ${compact ? "h-7 w-7" : "h-9 w-9"}`}
            />
            <span className="min-w-0 text-left text-xs font-semibold text-gray-900 sm:text-[13px]">
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );

  const instructionsCard = !selectedTool ? null : (
    <div className="w-full rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      {selectedTool === "claude" ? (
        <>
          <InstructionTabs
            tabs={[
              { id: "desktop" as const, label: "Claude AI Desktop" },
              { id: "cli" as const, label: "Claude Code CLI" },
            ]}
            active={activeClaudeTab}
            onChange={setActiveClaudeTab}
          />
          {activeClaudeTab === "desktop" ? (
            <div className="flex flex-col gap-3 text-sm leading-relaxed text-gray-700">
              <div className="flex gap-2">
                <StepCircle n={1} />
                <div>
                  <p className="font-medium text-gray-900">Copy the URL below:</p>
                  <div className="mt-1">
                    <CopyUrlRow value={urlProtocol} />
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <StepCircle n={2} />
                <div>
                  Go to Claude Desktop and hit <b>Customize</b> (toolbox icon) →{" "}
                  <b>Connectors</b> → click <b>+</b>
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() =>
                        openExternal("https://claude.ai/settings/connectors?modal=add-custom-connector")
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
                    >
                      Go to Claude <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <StepCircle n={3} />
                <div>
                  Name it <b>ContextMaster</b>, paste the URL and click connect
                </div>
              </div>
              <p className="text-xs text-gray-600">
                <span className="font-semibold text-gray-800">Done.</span>{" "}
                That&apos;s it — authentication is automatic.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 text-sm text-gray-700">
              <div className="flex gap-2">
                <StepCircle n={1} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900">
                    Run this command in your terminal:
                  </p>
                  <div className="mt-1">
                    <CodeCopyBlock value={claudeCli} />
                  </div>
                  <ApiKeyRow
                    apiKey={apiKey}
                    hasExistingKey={hasExistingKey}
                    generating={generating}
                    generateError={generateError}
                    onGenerate={onGenerate}
                  />
                </div>
              </div>
              <p className="text-xs text-gray-600">
                <span className="font-semibold text-gray-800">Done.</span> cntxt
                is now available in Claude Code CLI.
              </p>
            </div>
          )}
        </>
      ) : selectedTool === "codex" ? (
        <>
          <InstructionTabs
            tabs={[
              { id: "desktop" as const, label: "Codex Desktop" },
              { id: "cli" as const, label: "Codex CLI" },
            ]}
            active={activeCodexTab}
            onChange={setActiveCodexTab}
          />
          {activeCodexTab === "desktop" ? (
            <div className="flex flex-col gap-3 text-sm text-gray-700">
              <div className="flex gap-2">
                <StepCircle n={1} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900">Copy the URL below:</p>
                  <div className="mt-1">
                    <CopyUrlRow value={urlProtocol} />
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <StepCircle n={2} />
                <div>
                  Open <b>Codex Settings</b> → <b>MCP</b> → <b>Add server</b>{" "}
                  → select <b>Streamable HTTP</b> tab
                </div>
              </div>
              <div className="flex gap-2">
                <StepCircle n={3} />
                <div>
                  Name it <b>ContextMaster</b> and paste the URL
                </div>
              </div>
              <div className="flex gap-2">
                <StepCircle n={4} />
                <div>
                  Click <b>Authorize</b> → sign in with your cntxt account
                </div>
              </div>
              <p className="text-xs text-gray-600">
                <span className="font-semibold text-gray-800">Done.</span> cntxt
                tools are now available in every Codex session.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 text-sm text-gray-700">
              <div className="flex gap-2">
                <StepCircle n={1} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900">
                    Run this in your terminal:
                  </p>
                  <div className="mt-1">
                    <CodeCopyBlock value={codexCli} />
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    The second command opens a browser to authenticate.
                  </p>
                </div>
              </div>
              <p className="text-xs text-gray-600">
                <span className="font-semibold text-gray-800">Done.</span> cntxt
                tools are now available in every Codex session.
              </p>
            </div>
          )}
        </>
      ) : selectedTool === "chatgpt" ? (
        <div className="flex flex-col gap-3 text-sm text-gray-700">
          <div className="flex gap-2">
            <StepCircle n={1} />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-gray-900">Copy the URL below:</p>
              <div className="mt-1">
                <CopyUrlRow value={urlSse} />
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <StepCircle n={2} />
            <div>
              Go to ChatGPT, then turn on <b>Developer mode</b>, create an app,
              and paste the URL
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() =>
                    openExternal(
                      "https://chatgpt.com/#settings/Connectors/Advanced"
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  Go to ChatGPT <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-600">
            <span className="font-semibold text-gray-800">Done.</span> cntxt tools
            will now appear in your ChatGPT conversations.
          </p>
        </div>
      ) : selectedTool === "cursor" ? (
        <div className="flex flex-col gap-3 text-sm text-gray-700">
          <div className="flex gap-2">
            <StepCircle n={1} />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-gray-900">Copy the URL below:</p>
              <div className="mt-1">
                <CopyUrlRow value={urlSse} />
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <StepCircle n={2} />
            <div>
              Open Cursor Settings (⌘,) → scroll to <b>MCP</b> → click{" "}
              <b>Add new MCP server</b>
            </div>
          </div>
          <div className="flex gap-2">
            <StepCircle n={3} />
            <div>
              Name it <b>ContextMaster</b>, paste the URL, and click Save
            </div>
          </div>
          <p className="text-xs text-gray-600">
            <span className="font-semibold text-gray-800">Done.</span> cntxt tools
            will now appear in Cursor&apos;s AI panel.
          </p>
          <div className="my-1 flex items-center gap-3 py-1">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs font-medium text-gray-500">or</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>
          <p className="text-sm text-gray-700">
            Use this link: Cursor opens the MCP installer with cntxt
            pre-filled. Click <b>Install</b>, then complete authentication if
            prompted.
          </p>
          <div>
            <a
              href={cursorMcpInstallLink}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Open in Cursor <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      ) : selectedTool === "vscode" ? (
        <div className="flex flex-col gap-3 text-sm text-gray-700">
          <div className="flex gap-2">
            <StepCircle n={1} />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-gray-900">Copy the URL below:</p>
              <div className="mt-1">
                <CopyUrlRow value={urlProtocol} />
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <StepCircle n={2} />
            <div>
              Open VS Code → <b>Control+P</b> → type <b>&quot;MCP: Add Server&quot;</b>
            </div>
          </div>
          <div className="flex gap-2">
            <StepCircle n={3} />
            <div>
              Choose <b>&quot;HTTP (HTTP or Server-Sent Events)&quot;</b> → paste the URL
              and name it <b>ContextMaster</b>
            </div>
          </div>
          <p className="text-xs text-gray-600">
            <span className="font-semibold text-gray-800">Done.</span> Reload VS
            Code — cntxt tools will appear in Copilot. If the server fails to
            connect: Control+P → &quot;MCP: List Servers&quot; → click cntxt →{" "}
            <b>Reset/Start Server</b>.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-sm text-gray-700">
          <div className="flex gap-2">
            <StepCircle n={1} />
            <div>
              Open a Windsurf tab and hit <b>Control+P</b> → type{" "}
              <b>&quot;Windsurf: MCP Registry&quot;</b>
            </div>
          </div>
          <div className="flex gap-2">
            <StepCircle n={2} />
            <div className="min-w-0 flex-1">
              Click the settings/gear icon → paste this config into the config
              file
              <div className="mt-1">
                <CodeCopyBlock value={windsurfJson} />
              </div>
              <ApiKeyRow
                apiKey={apiKey}
                hasExistingKey={hasExistingKey}
                generating={generating}
                generateError={generateError}
                onGenerate={onGenerate}
              />
            </div>
          </div>
          <p className="text-xs text-gray-600">
            <span className="font-semibold text-gray-800">Done.</span> cntxt tools
            will now appear in Windsurf&apos;s AI assistant.
          </p>
        </div>
      )}
    </div>
  );

  const videoColumn = selectedTool === "claude" ? (
    <div className="flex w-full flex-col items-center gap-3">
      <VideoOrPlaceholder src={vClaudeTop} />
      <VideoOrPlaceholder src={vClaudeBot} />
    </div>
  ) : selectedTool === "chatgpt" ? (
    <div className="flex w-full flex-col items-center gap-3">
      <VideoOrPlaceholder src={vChatgpt} layout="chatgpt" />
      {tipChatgptVideo}
    </div>
  ) : selectedTool === "vscode" ? (
    <div className="flex w-full flex-col items-center gap-3">
      <VideoOrPlaceholder src={vCopilotTop} />
      <VideoOrPlaceholder src={vCopilotBottom} />
    </div>
  ) : selectedTool === "codex" ? (
    <div className="flex w-full flex-col items-center gap-3">
      <CodexComingSoon />
    </div>
  ) : null;

  const headline = (
    <div className="mb-8 text-center">
      <h1 className="text-[22px] font-semibold tracking-tight text-gray-900 sm:text-[24px]">
        Connect your AI tool
      </h1>
      <p className="mx-auto mt-2 max-w-xl px-2 text-sm leading-relaxed text-gray-600">
        Click your tool below to see the steps. You can connect more from
        Settings later.
      </p>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      {headline}
      <div className="flex justify-center">{toolGrid(!!selectedTool)}</div>

      {!selectedTool ? (
        <div className="mt-8 flex flex-col items-center gap-6">
          {tipNoTool}
          <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
            <button
              type="button"
              onClick={onContinue}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Continue <ArrowRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50"
            >
              I&apos;ll do this later
            </button>
          </div>
        </div>
      ) : (
        <>
          {selectedTool === "cursor" || selectedTool === "windsurf" ? (
            <div className="mt-8 flex w-full justify-center px-2">
              <div className="w-full max-w-[380px]">{instructionsCard}</div>
            </div>
          ) : (
            <div className="mt-8 flex w-full flex-col items-stretch gap-6 lg:flex-row lg:justify-center lg:gap-10">
              <div className="mx-auto w-full min-w-0 max-w-[380px] flex-shrink-0 lg:mx-0">
                {instructionsCard}
              </div>
              <div
                className={
                  selectedTool === "chatgpt"
                    ? "mx-auto flex w-full min-w-0 flex-1 flex-col lg:mx-0"
                    : "mx-auto flex w-full min-w-0 max-w-full flex-col lg:mx-0 lg:max-w-[min(42vw,24rem)]"
                }
              >
                {videoColumn}
              </div>
            </div>
          )}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
            <button
              type="button"
              onClick={onContinue}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              I&apos;ve connected <ArrowRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50"
            >
              I&apos;ll do this later
            </button>
          </div>
          <div className="mx-auto mt-8 w-full max-w-2xl px-4 pb-2 text-center">
            {tipCrossTool}
          </div>
        </>
      )}
    </div>
  );
}
