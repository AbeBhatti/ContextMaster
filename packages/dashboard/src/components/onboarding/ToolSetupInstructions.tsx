import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, Lightbulb, Loader2, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { useApiKeys } from "../../hooks/useApiKeys";
import { api } from "../../lib/api";
import type { CreatedApiKey } from "../../lib/types";
import { track } from "../../lib/analytics";

export type OnboardingToolId =
  | "claude"
  | "chatgpt"
  | "codex"
  | "cursor"
  | "vscode"
  | "windsurf";

import { getPublicMcpApiBase } from "../../lib/mcpPublicBase";

const REMOTE_BASE = getPublicMcpApiBase();
const URL_PROTOCOL = `${REMOTE_BASE}/mcp/protocol`;
const URL_SSE = `${REMOTE_BASE}/mcp/sse`;
const PLACEHOLDER_KEY = "YOUR_API_KEY";

const TEAL = "#5a8a8c";
const TEAL_BG = "rgba(90,138,140,0.06)";
const TEAL_BORDER = "rgba(90,138,140,0.45)";

type Variant = "settings" | "onboarding" | "help";

interface Props {
  variant?: Variant;
  /** Notifies parent when the user expands or collapses a tool card. */
  onToolSelect?: (id: OnboardingToolId | null) => void;
  /** When true, controls the initial expanded card (uncontrolled otherwise). */
  defaultExpanded?: OnboardingToolId | null;
}

const TOOLS: { id: OnboardingToolId; label: string; icon: string }[] = [
  { id: "claude", label: "Claude", icon: "✦" },
  { id: "chatgpt", label: "ChatGPT", icon: "◐" },
  { id: "codex", label: "Codex", icon: "⌘" },
  { id: "cursor", label: "Cursor", icon: "▸" },
  { id: "vscode", label: "VS Code", icon: "⌖" },
  { id: "windsurf", label: "Windsurf", icon: "⌇" },
];

export function ToolSetupInstructions({
  variant = "settings",
  onToolSelect,
  defaultExpanded = null,
}: Props) {
  const [expanded, setExpanded] = useState<OnboardingToolId | null>(
    defaultExpanded
  );
  const { data: keys, refetch } = useApiKeys();
  const [revealedKey, setRevealedKey] = useState<CreatedApiKey | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const activeKey = (keys ?? []).find((k) => !k.revoked_at);
  const hasExistingKey = !!activeKey;
  const apiKey = revealedKey?.key ?? PLACEHOLDER_KEY;
  const apiKeysHref =
    variant === "settings" ? "#api-keys" : "/settings#api-keys";

  const onSelect = (id: OnboardingToolId) => {
    const next = expanded === id ? null : id;
    setExpanded(next);
    onToolSelect?.(next);
  };

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

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3">
        {TOOLS.map((t) => {
          const isExpanded = expanded === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              className="group relative flex items-center gap-2.5 rounded-[10px] border bg-white px-3.5 py-3 text-left transition-all hover:border-[rgba(67,55,39,0.30)] hover:bg-cream-100"
              style={{
                borderColor: isExpanded ? TEAL : "rgba(67,55,39,0.14)",
                background: isExpanded ? TEAL_BG : "#fff",
                boxShadow: isExpanded ? `0 0 0 1px ${TEAL}` : undefined,
              }}
              aria-expanded={isExpanded}
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[14px] font-semibold"
                style={{
                  background: isExpanded ? TEAL : "rgba(67,55,39,0.08)",
                  color: isExpanded ? "#fff" : "#5a4d36",
                }}
              >
                {t.icon}
              </span>
              <span className="text-[13.5px] font-semibold text-ink-900">
                {t.label}
              </span>
            </button>
          );
        })}
      </div>

      {expanded && (
        <div
          className="rounded-[10px] border bg-cream-50/40 p-4"
          style={{ borderColor: TEAL_BORDER }}
        >
          {revealedKey && (
            <RevealedKeyBanner
              keyValue={revealedKey.key}
              onDismiss={() => setRevealedKey(null)}
            />
          )}
          <ToolContent
            tool={expanded}
            apiKey={apiKey}
            hasExistingKey={hasExistingKey}
            apiKeysHref={apiKeysHref}
            generating={generating}
            generateError={generateError}
            onGenerate={onGenerate}
            justGenerated={!!revealedKey}
          />
        </div>
      )}

      {variant === "help" ? <TipsCard /> : <CyclingTipsStrip />}
    </div>
  );
}

const CYCLING_TIPS = [
  'Say "check my memory" to recall past decisions and progress',
  'Say "save this" to store what you\'ve worked on',
  'Say "search my [project name] for..." to find specific info',
  "Works across Claude, ChatGPT, Codex, Cursor, and more",
  "Knowledge saved in one tool is available in all your others",
];

function CyclingTipsStrip() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const id = setInterval(() => {
      setVisible(false);
      window.setTimeout(() => {
        setIndex((i) => (i + 1) % CYCLING_TIPS.length);
        setVisible(true);
      }, 300);
    }, 4000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col items-center gap-1.5 pt-1">
      <div
        className="text-center text-[12px] leading-relaxed text-ink-500 transition-opacity duration-300"
        style={{ opacity: visible ? 1 : 0 }}
      >
        <span aria-hidden="true">💡</span> {CYCLING_TIPS[index]}
      </div>
      <div className="flex gap-1">
        {CYCLING_TIPS.map((_, i) => (
          <span
            key={i}
            className="h-1 w-1 rounded-full transition-colors"
            style={{
              background:
                i === index ? "rgba(67,55,39,0.45)" : "rgba(67,55,39,0.15)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

interface ContentProps {
  tool: OnboardingToolId;
  apiKey: string;
  hasExistingKey: boolean;
  apiKeysHref: string;
  generating: boolean;
  generateError: string | null;
  onGenerate: () => void;
  justGenerated: boolean;
}

function ToolContent(props: ContentProps) {
  const { tool, ...rest } = props;
  switch (tool) {
    case "claude":
      return <ClaudeCard {...rest} />;
    case "chatgpt":
      return <ChatGPTCard />;
    case "codex":
      return <CodexCard />;
    case "cursor":
      return <ConfigCard tool="cursor" {...rest} />;
    case "vscode":
      return <ConfigCard tool="vscode" {...rest} />;
    case "windsurf":
      return <ConfigCard tool="windsurf" {...rest} />;
  }
}

function ClaudeCard({
  apiKey,
  hasExistingKey,
  apiKeysHref,
  generating,
  generateError,
  onGenerate,
  justGenerated,
}: Omit<ContentProps, "tool">) {
  const cliCommand = `claude mcp add --transport http cntxt ${URL_PROTOCOL} --header "Authorization: Bearer ${apiKey}" --scope user`;
  const [tab, setTab] = useState<"web" | "cli">("web");
  return (
    <div className="flex flex-col gap-4">
      <Tabs
        tabs={[
          { id: "web", label: "Claude.ai & Desktop" },
          { id: "cli", label: "Claude Code CLI" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "web" ? (
        <div className="flex flex-col gap-2.5">
          <Steps
            steps={[
              <>
                Open <B>Settings → Connectors</B>.
              </>,
              <>
                Click <B>"Add custom connector"</B>, name it <B>cntxt</B>, and
                paste this URL:
              </>,
              <>
                Click <B>Add</B> → sign in with your Context Cloud account when
                prompted.
              </>,
            ]}
          />
          <CopyField value={URL_PROTOCOL} tool="claude" />
          <Done>That's it — authentication is automatic.</Done>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <p className="text-[12.5px] leading-relaxed text-ink-700">
            Run this in your terminal:
          </p>
          <CodeBlock value={cliCommand} tool="claude" />
          <ApiKeyHint
            apiKey={apiKey}
            hasExistingKey={hasExistingKey}
            apiKeysHref={apiKeysHref}
            generating={generating}
            generateError={generateError}
            onGenerate={onGenerate}
            justGenerated={justGenerated}
          />
        </div>
      )}
    </div>
  );
}

function ChatGPTCard() {
  return (
    <Section title="ChatGPT (Web + App)">
      <Steps
        steps={[
          <>
            Open <B>Settings → Apps → Advanced settings</B> and turn on{" "}
            <B>Developer mode</B>.
          </>,
          <>
            Click <B>"Create app"</B> and paste this URL:
          </>,
          <>
            Click <B>Authenticate</B> → sign in with your Context Cloud account.
          </>,
        ]}
      />
      <CopyField value={URL_SSE} tool="chatgpt" />
      <Done>Context Cloud tools will now appear in your ChatGPT conversations.</Done>
    </Section>
  );
}

function CodexCard() {
  const cliCommand = `codex mcp add cntxt --url ${URL_PROTOCOL}\ncodex mcp login cntxt`;
  const [tab, setTab] = useState<"web" | "cli">("web");
  return (
    <div className="flex flex-col gap-4">
      <Tabs
        tabs={[
          { id: "web", label: "Codex Web" },
          { id: "cli", label: "Codex CLI" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "web" ? (
        <div className="flex flex-col gap-2.5">
          <Steps
            steps={[
              <>
                Open <B>Settings → MCP → Add server</B>.
              </>,
              <>
                Select the <B>Streamable HTTP</B> tab.
              </>,
              <>
                Name it <B>cntxt</B> and paste this URL:
              </>,
              <>
                Click <B>Authorize</B> → sign in with your Context Cloud account.
              </>,
            ]}
          />
          <CopyField value={URL_PROTOCOL} tool="codex" />
          <Done>Context Cloud is now connected to Codex.</Done>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <p className="text-[12.5px] leading-relaxed text-ink-700">
            Run this in your terminal:
          </p>
          <CodeBlock value={cliCommand} tool="codex" />
          <Hint>The second command opens a browser to authenticate.</Hint>
        </div>
      )}
    </div>
  );
}

function ConfigCard({
  tool,
  apiKey,
  hasExistingKey,
  apiKeysHref,
  generating,
  generateError,
  onGenerate,
  justGenerated,
}: Omit<ContentProps, "tool"> & { tool: "cursor" | "vscode" | "windsurf" }) {
  const config = mcpConfig(apiKey);

  return (
    <Section title={configTitle(tool)}>
      <p className="text-[12.5px] leading-relaxed text-ink-700">
        {configIntro(tool)}
      </p>
      {tool === "vscode" && (
        <ul className="ml-3 mt-1 flex flex-col gap-0.5 text-[12.5px] text-ink-700">
          <li>
            <span className="font-semibold">Mac/Linux:</span>{" "}
            <Code>~/.vscode/mcp.json</Code>
          </li>
          <li>
            <span className="font-semibold">Windows:</span>{" "}
            <Code>%USERPROFILE%/.vscode/mcp.json</Code>
          </li>
        </ul>
      )}
      <CodeBlock value={config} tool={tool} />
      <ApiKeyHint
        apiKey={apiKey}
        hasExistingKey={hasExistingKey}
        apiKeysHref={apiKeysHref}
        generating={generating}
        generateError={generateError}
        onGenerate={onGenerate}
        justGenerated={justGenerated}
      />
      <Hint>Restart {configRestartLabel(tool)} after saving.</Hint>
      {tool === "vscode" && (
        <Hint>MCP in VS Code Copilot is experimental and the setup may change.</Hint>
      )}
    </Section>
  );
}

function configTitle(tool: "cursor" | "vscode" | "windsurf"): string {
  switch (tool) {
    case "cursor":
      return "Cursor";
    case "vscode":
      return "VS Code";
    case "windsurf":
      return "Windsurf";
  }
}

function configIntro(tool: "cursor" | "vscode" | "windsurf"): string {
  switch (tool) {
    case "cursor":
      return "Add this to your Cursor MCP config file (~/.cursor/mcp.json):";
    case "vscode":
      return "Add this to your VS Code MCP config file:";
    case "windsurf":
      return "Add this to your Windsurf MCP config and restart:";
  }
}

function configRestartLabel(tool: "cursor" | "vscode" | "windsurf"): string {
  switch (tool) {
    case "cursor":
      return "Cursor";
    case "vscode":
      return "VS Code";
    case "windsurf":
      return "Windsurf";
  }
}

function mcpConfig(apiKey: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        cntxt: {
          command: "npx",
          args: ["@contextcloud/mcp-client"],
          env: {
            CNTXT_API_KEY: apiKey,
            CNTXT_API_URL: REMOTE_BASE,
          },
        },
      },
    },
    null,
    2
  );
}

function ApiKeyHint({
  apiKey,
  hasExistingKey,
  apiKeysHref,
  generating,
  generateError,
  onGenerate,
  justGenerated,
}: {
  apiKey: string;
  hasExistingKey: boolean;
  apiKeysHref: string;
  generating: boolean;
  generateError: string | null;
  onGenerate: () => void;
  justGenerated: boolean;
}) {
  const usingPlaceholder = apiKey === PLACEHOLDER_KEY;

  if (justGenerated) {
    return (
      <div className="text-[12px] leading-relaxed text-ink-600">
        Your new API key is filled in above. Copy the snippet now — the key
        won't be retrievable later.
      </div>
    );
  }

  if (hasExistingKey && usingPlaceholder) {
    return (
      <div className="text-[12px] leading-relaxed text-ink-600">
        Replace <Code>{PLACEHOLDER_KEY}</Code> with your API key from the{" "}
        <KeySectionLink apiKeysHref={apiKeysHref}>
          Developer section below
        </KeySectionLink>
        .
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[12px] leading-relaxed text-ink-600">
        Replace <Code>{PLACEHOLDER_KEY}</Code> with your API key, or generate
        one now.
      </div>
      <div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink-800 px-3 py-1.5 text-[12px] font-medium text-cream-50 hover:bg-ink-900 disabled:opacity-60"
        >
          {generating ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Sparkles size={12} />
          )}
          Generate API Key
        </button>
      </div>
      {generateError && (
        <div className="text-[11.5px] text-[#b04545]">{generateError}</div>
      )}
    </div>
  );
}

function KeySectionLink({
  apiKeysHref,
  children,
}: {
  apiKeysHref: string;
  children: ReactNode;
}) {
  if (apiKeysHref.startsWith("/")) {
    return (
      <Link
        to={apiKeysHref}
        className="font-medium text-ink-900 underline decoration-ink-300 underline-offset-2 hover:decoration-ink-700"
      >
        {children}
      </Link>
    );
  }
  return (
    <a
      href={apiKeysHref}
      className="font-medium text-ink-900 underline decoration-ink-300 underline-offset-2 hover:decoration-ink-700"
    >
      {children}
    </a>
  );
}

function RevealedKeyBanner({
  keyValue,
  onDismiss,
}: {
  keyValue: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      .writeText(keyValue)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };
  return (
    <div
      className="mb-4 rounded-[9px] border p-3"
      style={{
        background: "rgba(95,165,122,.08)",
        borderColor: "rgba(95,165,122,.4)",
      }}
    >
      <div className="text-[12.5px] font-semibold text-[#2f6b48]">
        Key generated — copy it now. You won't see it again.
      </div>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 break-all rounded-md bg-white p-2 font-mono text-[12px] text-ink-900">
          {keyValue}
        </code>
        <button
          onClick={copy}
          className="flex h-8 items-center gap-1.5 rounded-md border bg-white px-2.5 text-[12px] font-medium text-ink-800"
          style={{ borderColor: "rgba(67,55,39,0.18)" }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <button
        onClick={onDismiss}
        className="mt-2 text-[12px] text-ink-600 underline"
      >
        Dismiss
      </button>
    </div>
  );
}

function TipsCard() {
  return (
    <div
      className="rounded-[10px] border p-3.5"
      style={{
        background: "rgba(214,162,74,0.06)",
        borderColor: "rgba(214,162,74,0.30)",
      }}
    >
      <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#8a5e1f]">
        <Lightbulb size={12} /> How to use Context Cloud
      </div>
      <div className="mt-2 text-[12.5px] leading-relaxed text-ink-800">
        <p>
          Say <Q>check my memory</Q> to recall past decisions and progress. Say{" "}
          <Q>save this</Q> to store what you've worked on.
        </p>
        <p className="mt-2">
          <span className="font-semibold text-ink-900">For Claude users:</span>{" "}
          For hands-free recall, turn off{" "}
          <span className="font-semibold">"Search and reference past chats"</span>{" "}
          in Claude Settings → Privacy.
        </p>
        <p className="mt-2">
          <span className="font-semibold text-ink-900">For ChatGPT users:</span>{" "}
          Add this to your custom instructions for automatic use:
        </p>
        <p
          className="mt-1.5 rounded-md bg-white/60 px-2.5 py-2 font-mono text-[11.5px] italic text-ink-800"
          style={{ borderLeft: "2px solid rgba(214,162,74,0.5)" }}
        >
          "I have Context Cloud connected. Always check Context Cloud (check_memory) at the
          start of conversations about ongoing work. Suggest saving progress at
          session end."
        </p>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[13px] font-semibold text-ink-900">{title}</div>
      {children}
    </div>
  );
}

function Tabs<T extends string>({
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
      className="flex items-center gap-1 border-b"
      style={{ borderColor: "rgba(67,55,39,0.10)" }}
      role="tablist"
    >
      {tabs.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            className="relative -mb-px px-3 py-2 text-[12.5px] font-semibold transition-colors"
            style={{
              color: isActive ? TEAL : "rgba(67,55,39,0.55)",
              borderBottom: `2px solid ${isActive ? TEAL : "transparent"}`,
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function Steps({ steps }: { steps: ReactNode[] }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {steps.map((step, i) => (
        <li
          key={i}
          className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-700"
        >
          <span
            className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-cream-50"
            style={{ background: "#3a3320" }}
          >
            {i + 1}
          </span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

function B({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-ink-900">{children}</span>;
}

function Q({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-ink-900">"{children}"</span>;
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-cream-200 px-1 py-px font-mono text-[11.5px] text-ink-800">
      {children}
    </code>
  );
}

function Done({ children }: { children: ReactNode }) {
  return (
    <div className="text-[12px] leading-relaxed text-ink-600">
      <span className="font-semibold text-ink-800">Done.</span> {children}
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11.5px] leading-relaxed text-ink-500">{children}</div>
  );
}

function CopyField({ value, tool }: { value: string; tool?: OnboardingToolId }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        if (tool) track("settings.mcp_config_copied", { tool });
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };
  return (
    <div className="flex items-center gap-2">
      <code
        className="flex-1 truncate rounded-md border bg-white px-2.5 py-1.5 font-mono text-[12px] text-ink-900"
        style={{ borderColor: "rgba(67,55,39,0.18)" }}
      >
        {value}
      </code>
      <button
        onClick={onCopy}
        className="flex h-8 items-center gap-1.5 rounded-md border bg-white px-2.5 text-[12px] font-medium text-ink-800 hover:bg-cream-100"
        style={{ borderColor: "rgba(67,55,39,0.18)" }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function CodeBlock({ value, tool }: { value: string; tool?: OnboardingToolId }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        if (tool) track("settings.mcp_config_copied", { tool });
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };
  return (
    <div className="relative">
      <pre
        className="overflow-x-auto whitespace-pre-wrap break-all rounded-[9px] border bg-cream-50 p-3 pr-20 font-mono text-[11.5px] leading-relaxed text-ink-900"
        style={{ borderColor: "rgba(67,55,39,0.12)" }}
      >
        {value}
      </pre>
      <button
        onClick={onCopy}
        className="absolute right-2 top-2 flex items-center gap-1 rounded-md border bg-white px-2 py-1 text-[11px] font-medium text-ink-700 hover:bg-cream-100"
        style={{ borderColor: "rgba(67,55,39,0.18)" }}
      >
        {copied ? <Check size={10} /> : <Copy size={10} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
