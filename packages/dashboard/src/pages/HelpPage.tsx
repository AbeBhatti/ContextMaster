import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Search,
} from "lucide-react";
import { ToolSetupInstructions } from "../components/onboarding/ToolSetupInstructions";
import { ONBOARDING_KEY } from "./OnboardingPage";
import { useUser } from "../hooks/useUser";

interface Section {
  id: string;
  title: string;
  /** Anchor-friendly subsections used for the TOC. */
  items: { id: string; title: string }[];
}

const SECTIONS: Section[] = [
  {
    id: "getting-started",
    title: "Getting started",
    items: [
      { id: "getting-started-quick", title: "Quick start" },
      { id: "getting-started-rerun", title: "Re-run onboarding" },
    ],
  },
  {
    id: "how-it-works",
    title: "How it works",
    items: [
      { id: "what-is-kb", title: "What is a Knowledge Base?" },
      { id: "what-are-chunks", title: "What are Chunks?" },
      { id: "how-save", title: "How does my AI save knowledge?" },
      { id: "how-recall", title: "How does my AI retrieve knowledge?" },
      { id: "new-session", title: "What happens in a new session?" },
    ],
  },
  {
    id: "features",
    title: "Features",
    items: [
      { id: "graph", title: "Knowledge Graph" },
      { id: "documents", title: "Document Upload" },
      { id: "team", title: "Team Collaboration" },
      { id: "orgs", title: "Organizations" },
      { id: "privacy", title: "Workspace Privacy" },
    ],
  },
  {
    id: "connect",
    title: "Connecting your AI tool",
    items: [
      { id: "connect-tools", title: "Setup by tool" },
      { id: "connect-troubleshoot-1", title: "My AI isn't using ContextMaster" },
      { id: "connect-troubleshoot-2", title: "I don't see my knowledge bases" },
    ],
  },
  {
    id: "faq",
    title: "FAQ",
    items: [],
  },
];

export function HelpPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const userQ = useUser();
  const [search, setSearch] = useState("");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    "getting-started": true,
    "how-it-works": true,
    features: true,
    connect: true,
    faq: true,
  });

  // Smooth-scroll to the hash on first load (e.g. /help#connect from settings).
  useEffect(() => {
    if (!location.hash) return;
    const el = document.getElementById(location.hash.slice(1));
    if (!el) return;
    requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [location.hash]);

  const toggle = (id: string) =>
    setOpenSections((s) => ({ ...s, [id]: !s[id] }));

  const matchesSearch = (text: string): boolean => {
    if (!search.trim()) return true;
    return text.toLowerCase().includes(search.toLowerCase());
  };

  const filteredSections = useMemo(() => {
    if (!search.trim()) return SECTIONS;
    return SECTIONS.filter(
      (s) =>
        matchesSearch(s.title) ||
        s.items.some((i) => matchesSearch(i.title))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const rerunOnboarding = () => {
    try {
      window.localStorage.removeItem(ONBOARDING_KEY(userQ.data?.id));
    } catch {
      // ignore
    }
    navigate("/onboarding");
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 pb-12 pt-5">
      <div className="mx-auto flex w-full max-w-5xl gap-8">
        <aside className="sticky top-5 hidden h-fit w-[200px] shrink-0 lg:block">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
            On this page
          </div>
          <nav className="mt-2 flex flex-col gap-0.5">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="rounded-md px-2 py-1.5 text-[12.5px] text-ink-700 hover:bg-cream-200"
              >
                {s.title}
              </a>
            ))}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 hover:bg-cream-200"
              title="Back"
            >
              <ArrowLeft size={14} />
            </button>
            <div className="text-[18px] font-semibold text-ink-900">Help</div>
          </div>

          <div
            className="flex items-center gap-2 rounded-md border bg-white px-2.5 py-2"
            style={{ borderColor: "rgba(24,24,27,0.14)" }}
          >
            <Search size={13} className="text-ink-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search help — e.g. cursor, knowledge graph, invite teammate"
              className="flex-1 bg-transparent text-[13px] text-ink-900 outline-none placeholder:text-ink-500"
            />
          </div>

          {filteredSections.length === 0 && (
            <div className="rounded-md border bg-white p-6 text-center text-[13px] text-ink-500"
              style={{ borderColor: "rgba(24,24,27,0.10)" }}
            >
              No matches for "{search}".
            </div>
          )}

          {filteredSections.find((s) => s.id === "getting-started") && (
            <CollapsibleSection
              id="getting-started"
              title="Getting started"
              open={openSections["getting-started"]}
              onToggle={() => toggle("getting-started")}
            >
              <Subsection id="getting-started-quick" title="Quick start">
                <p>
                  ContextMaster is your AI's memory. After connecting, you can save
                  knowledge from any conversation and recall it later — across
                  sessions, devices, and teammates.
                </p>
                <ol className="mt-2 ml-4 list-decimal space-y-1 text-ink-700">
                  <li>
                    Connect your AI tool — see{" "}
                    <a className="underline" href="#connect">
                      Connecting your AI tool
                    </a>
                    .
                  </li>
                  <li>
                    Have a conversation. When something matters, just say{" "}
                    <span className="font-semibold">"save this"</span> and your
                    AI will capture the key parts into your knowledge base.
                  </li>
                  <li>
                    Come back to the dashboard to see your knowledge graph fill
                    up.
                  </li>
                </ol>
              </Subsection>
              <Subsection id="getting-started-rerun" title="Re-run onboarding">
                <p>
                  Want the guided tour again? You can replay the onboarding
                  flow at any time.
                </p>
                <button
                  onClick={rerunOnboarding}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-ink-800 px-3 py-1.5 text-[12.5px] font-medium text-cream-50"
                >
                  Replay onboarding
                </button>
              </Subsection>
            </CollapsibleSection>
          )}

          {filteredSections.find((s) => s.id === "how-it-works") && (
            <CollapsibleSection
              id="how-it-works"
              title="How it works"
              open={openSections["how-it-works"]}
              onToggle={() => toggle("how-it-works")}
            >
              <Subsection id="what-is-kb" title="What is a Knowledge Base?">
                <p>
                  A knowledge base is a topic-specific bucket of memory inside
                  a workspace. For example, you might have one for "Backend
                  API," one for "Frontend Design," and one for "Customer
                  Research." Your AI uses the topic to decide where each new
                  piece of knowledge belongs.
                </p>
                <p className="mt-2">
                  <span className="font-semibold">Example:</span> in a
                  Software workspace, your AI might create knowledge bases for
                  each major feature. Each one accumulates decisions, findings,
                  and conventions specific to that area.
                </p>
              </Subsection>
              <Subsection id="what-are-chunks" title="What are Chunks?">
                <p>
                  Chunks are individual pieces of knowledge inside a knowledge
                  base. They come in six types:
                </p>
                <ul className="mt-2 ml-4 list-disc space-y-1 text-ink-700">
                  <li>
                    <span className="font-semibold">Decisions</span> — choices
                    you've made and why ("we use Postgres because…")
                  </li>
                  <li>
                    <span className="font-semibold">Findings</span> — things
                    you've discovered or learned
                  </li>
                  <li>
                    <span className="font-semibold">Conventions</span> — rules,
                    standards, or patterns you follow
                  </li>
                  <li>
                    <span className="font-semibold">State</span> — current
                    progress and where you left off
                  </li>
                  <li>
                    <span className="font-semibold">Questions</span> — open
                    questions you want to revisit
                  </li>
                  <li>
                    <span className="font-semibold">References</span> — links,
                    sources, and pointers to external info
                  </li>
                </ul>
              </Subsection>
              <Subsection
                id="how-save"
                title="How does my AI save knowledge?"
              >
                <p>
                  You're in control of what gets saved. When you say{" "}
                  <span className="font-semibold">"save this"</span>,{" "}
                  <span className="font-semibold">"save my progress"</span>, or{" "}
                  <span className="font-semibold">"save this to ContextMaster"</span>,
                  your AI calls the{" "}
                  <code className="rounded bg-cream-200 px-1 text-[11.5px]">
                    commit
                  </code>{" "}
                  tool. It picks the right knowledge base, writes a short,
                  searchable summary, and stores it. You'll usually see the AI
                  confirm: "Saved to your project context."
                </p>
                <p className="mt-2">
                  Your AI may also suggest saving on its own when something big
                  comes up — but nothing is saved silently. You always decide.
                </p>
                <p className="mt-2">
                  You can review every saved chunk in the workspace's chunk
                  list and edit or delete anything that doesn't belong.
                </p>
              </Subsection>
              <Subsection
                id="how-recall"
                title="How does my AI retrieve knowledge?"
              >
                <p>
                  When you mention a project or ask a question that touches
                  prior context, your AI calls the{" "}
                  <code className="rounded bg-cream-200 px-1 text-[11.5px]">
                    recall
                  </code>{" "}
                  tool to search across your knowledge bases. The most relevant
                  chunks are pulled in as context, so the AI answers as if it
                  remembers.
                </p>
              </Subsection>
              <Subsection
                id="new-session"
                title="What happens when I start a new session?"
              >
                <p>
                  At the start of a fresh conversation, your AI calls the{" "}
                  <code className="rounded bg-cream-200 px-1 text-[11.5px]">
                    get_context
                  </code>{" "}
                  tool with the project name you mention. It pulls the most
                  recent state, decisions, and open questions — so the AI can
                  pick up where you left off without you re-explaining.
                </p>
              </Subsection>
            </CollapsibleSection>
          )}

          {filteredSections.find((s) => s.id === "features") && (
            <CollapsibleSection
              id="features"
              title="Features"
              open={openSections.features}
              onToggle={() => toggle("features")}
            >
              <Subsection id="graph" title="Knowledge Graph">
                <p>
                  The graph view shows every knowledge base in your workspace
                  as a circle. Larger circles have more chunks. Lines connect
                  knowledge bases that share related concepts. Click any circle
                  to drill into its chunks.
                </p>
              </Subsection>
              <Subsection id="documents" title="Document Upload">
                <p>
                  Drop a PDF, .docx, .txt, .md, or .csv into the Documents tab
                  and ContextMaster processes it into searchable chunks your AI can
                  reference. Useful for project briefs, design docs, research
                  papers, or any reference material.
                </p>
                <p className="mt-2">
                  Max file size: 10 MB. Larger documents are split into smaller
                  chunks automatically.
                </p>
              </Subsection>
              <Subsection id="team" title="Team Collaboration">
                <p>
                  Invite teammates to a workspace from the Team tab. Each
                  member's AI sessions can read from and write to the same
                  shared knowledge — so what one person learns is available to
                  the whole team. Roles control who can edit knowledge versus
                  view it.
                </p>
              </Subsection>
              <Subsection id="orgs" title="Organizations">
                <p>
                  Organizations group multiple workspaces under one umbrella —
                  a company, a research lab, a client engagement. Inside an
                  organization you can share knowledge bases across workspaces
                  so common information is reusable.
                </p>
              </Subsection>
              <Subsection id="privacy" title="Workspace Privacy">
                <p>
                  Workspaces have two retrieval modes:
                </p>
                <ul className="mt-2 ml-4 list-disc space-y-1 text-ink-700">
                  <li>
                    <span className="font-semibold">Open</span> — your AI can
                    search across all knowledge bases in the workspace.
                  </li>
                  <li>
                    <span className="font-semibold">Restricted</span> — your AI
                    only searches knowledge bases you explicitly mention.
                    Useful when you want strict separation between projects.
                  </li>
                </ul>
              </Subsection>
            </CollapsibleSection>
          )}

          {filteredSections.find((s) => s.id === "connect") && (
            <CollapsibleSection
              id="connect"
              title="Connecting your AI tool"
              open={openSections.connect}
              onToggle={() => toggle("connect")}
            >
              <Subsection id="connect-tools" title="Setup by tool">
                <ToolSetupInstructions variant="help" />
              </Subsection>
              <Subsection
                id="connect-troubleshoot-1"
                title="My AI isn't using ContextMaster"
              >
                <p>
                  If your AI is searching its own chat history instead of your
                  ContextMaster knowledge bases, try:
                </p>
                <ul className="mt-2 ml-4 list-disc space-y-1 text-ink-700">
                  <li>
                    Turn off{" "}
                    <span className="font-semibold">
                      "Search and reference past chats"
                    </span>{" "}
                    in your AI tool's settings (in Claude: Settings → Privacy).
                  </li>
                  <li>
                    Be specific: say{" "}
                    <span className="font-semibold">
                      "check my ContextMaster knowledge base"
                    </span>{" "}
                    or{" "}
                    <span className="font-semibold">"what does ContextMaster say about…"</span>
                  </li>
                  <li>
                    ContextMaster stores structured, curated knowledge (decisions,
                    findings, conventions). Chat history stores raw conversation
                    text. If you want the curated version, point your AI to
                    ContextMaster.
                  </li>
                </ul>
                <p className="mt-3 font-semibold text-ink-800">
                  Other things to check:
                </p>
                <ul className="mt-1 ml-4 list-disc space-y-1 text-ink-700">
                  <li>Check that the connector shows as "connected" in your AI tool's settings.</li>
                  <li>
                    Verify ContextMaster tools (commit, recall, get_context, get_history,
                    list_knowledge_bases) appear in the tool's tool list.
                  </li>
                  <li>
                    Try restarting the AI app — some clients only load MCP
                    connectors at startup.
                  </li>
                  <li>
                    If you're using a local config, make sure the CNTXT_API_KEY
                    matches a key shown in Developer / Advanced.
                  </li>
                </ul>
              </Subsection>
              <Subsection
                id="connect-troubleshoot-2"
                title="I don't see my knowledge bases"
              >
                <ul className="ml-4 list-disc space-y-1 text-ink-700">
                  <li>
                    Confirm you're signed into the same ContextMaster account in your AI
                    tool that you're using here.
                  </li>
                  <li>
                    Check the workspace dropdown — you might be viewing a
                    different workspace than your AI is connected to.
                  </li>
                  <li>
                    For restricted workspaces, your AI only sees knowledge bases
                    you explicitly mention by name.
                  </li>
                </ul>
              </Subsection>
            </CollapsibleSection>
          )}

          {filteredSections.find((s) => s.id === "faq") && (
            <CollapsibleSection
              id="faq"
              title="FAQ"
              open={openSections.faq}
              onToggle={() => toggle("faq")}
            >
              <FAQ
                question="Is my data private?"
                answer={
                  <>
                    Yes. Workspaces are private to their members, and each user
                    only sees data from workspaces they belong to. Role-based
                    permissions control who can edit versus just read. See our{" "}
                    <a
                      href="/privacy"
                      className="font-medium text-ink-900 underline decoration-ink-300 underline-offset-2 hover:decoration-ink-700"
                    >
                      Privacy Policy
                    </a>{" "}
                    for full details on data handling.
                  </>
                }
              />
              <FAQ
                question="What AI tools does ContextMaster work with?"
                answer="Claude (web + desktop), ChatGPT (web + app), OpenAI Codex, Cursor, VS Code (Copilot), and Windsurf. Any MCP-compatible client should work."
              />
              <FAQ
                question="Can I use ContextMaster for free?"
                answer="Yes — everything is free during early access. You currently have full access to all features."
              />
              <FAQ
                question="How do I delete my data?"
                answer="You can archive individual chunks, delete entire knowledge bases, or delete a whole workspace from its Settings tab. Deletions are permanent."
              />
              <FAQ
                question="Can my AI see other people's workspaces?"
                answer="No. Your AI only has access to workspaces you're a member of. It cannot see anything outside that boundary."
              />
            </CollapsibleSection>
          )}
        </div>
      </div>
    </div>
  );
}

function CollapsibleSection({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="rounded-[10px] border bg-white"
      style={{ borderColor: "rgba(24,24,27,0.10)" }}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        {open ? (
          <ChevronDown size={14} className="text-ink-500" />
        ) : (
          <ChevronRight size={14} className="text-ink-500" />
        )}
        <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
      </button>
      {open && (
        <div
          className="flex flex-col gap-4 border-t px-4 py-4"
          style={{ borderColor: "rgba(24,24,27,0.10)" }}
        >
          {children}
        </div>
      )}
    </section>
  );
}

function Subsection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="flex flex-col gap-1.5">
      <h3 className="text-[13.5px] font-semibold text-ink-900">{title}</h3>
      <div className="text-[13px] leading-relaxed text-ink-700">{children}</div>
    </div>
  );
}

function FAQ({
  question,
  answer,
}: {
  question: string;
  answer: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-md border bg-cream-50/40"
      style={{ borderColor: "rgba(24,24,27,0.10)" }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        {open ? (
          <ChevronDown size={12} className="text-ink-500" />
        ) : (
          <ChevronRight size={12} className="text-ink-500" />
        )}
        <span className="text-[13px] font-medium text-ink-900">{question}</span>
      </button>
      {open && (
        <div
          className="border-t px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-700"
          style={{ borderColor: "rgba(24,24,27,0.10)" }}
        >
          {answer}
        </div>
      )}
    </div>
  );
}

