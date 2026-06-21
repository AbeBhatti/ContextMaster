import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  SignInButton as ClerkSignInButton,
  SignUpButton as ClerkSignUpButton,
} from "@clerk/clerk-react";
import { AUTH_BYPASS_ENABLED } from "../lib/constants";
import {
  ArrowRight,
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Globe,
  Layers,
  Search,
  Shield,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";

// In auth-bypass dev mode there's no ClerkProvider in the tree, so the real
// Clerk buttons throw on render. Fall back to plain wrappers that just render
// their child so the page is previewable without a Clerk key.
function SignUpButton({ children }: { mode: "modal"; children: React.ReactNode }) {
  if (AUTH_BYPASS_ENABLED) return <>{children}</>;
  return <ClerkSignUpButton mode="modal">{children}</ClerkSignUpButton>;
}

function SignInButton({ children }: { mode: "modal"; children: React.ReactNode }) {
  if (AUTH_BYPASS_ENABLED) return <>{children}</>;
  return <ClerkSignInButton mode="modal">{children}</ClerkSignInButton>;
}

export function LandingPage() {
  return (
    <div
      className="h-screen w-screen overflow-y-auto bg-cream-50 text-ink-900"
      style={{ scrollBehavior: "smooth" }}
    >
      <Nav />
      <Hero />
      <Services />
      <HowItWorks />
      <WhyContextCloud />
      <Comparison />
      <Pricing />
      <FAQ />
      <ClosingCTA />
      <About />
      <Footer />
    </div>
  );
}

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="sticky top-0 z-50 w-full transition-colors"
      style={{
        background: scrolled ? "rgba(255,250,240,0.85)" : "transparent",
        backdropFilter: scrolled ? "saturate(140%) blur(10px)" : "none",
        borderBottom: scrolled
          ? "0.5px solid rgba(67,55,39,0.10)"
          : "0.5px solid transparent",
      }}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3.5">
        <a href="#top" className="flex items-center gap-2.5">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[12px] font-bold tracking-wider text-cream-50"
            style={{ background: "linear-gradient(135deg,#3a3320,#5a4d36)" }}
          >
            cn
          </div>
          <div className="text-[15px] font-semibold tracking-tight">Context Cloud</div>
        </a>
        <nav className="hidden items-center gap-7 md:flex">
          <a
            href="#how"
            className="text-[13px] text-ink-700 transition-colors hover:text-ink-900"
          >
            How it works
          </a>
          <a
            href="#why"
            className="text-[13px] text-ink-700 transition-colors hover:text-ink-900"
          >
            Why Context Cloud
          </a>
          <a
            href="#pricing"
            className="text-[13px] text-ink-700 transition-colors hover:text-ink-900"
          >
            Pricing
          </a>
          <a
            href="/blog/"
            className="text-[13px] text-ink-700 transition-colors hover:text-ink-900"
          >
            Blog
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <SignInButton mode="modal">
            <button className="rounded-md px-3 py-1.5 text-[13px] font-medium text-ink-800 transition-colors hover:bg-cream-200">
              Sign in
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button
              className="flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[13px] font-semibold text-cream-50 transition-opacity hover:opacity-90"
              style={{ background: "linear-gradient(135deg,#3a3320,#5a4d36)" }}
            >
              Get started
              <ArrowRight size={12} />
            </button>
          </SignUpButton>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section
      id="top"
      className="relative isolate overflow-hidden px-6 pb-24 pt-20 sm:pt-28"
    >
      <BackgroundGlow />
      <div className="relative mx-auto grid w-full max-w-6xl items-start gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        <Reveal>
          <div className="flex flex-col items-start">
            <div
              className="mb-6 inline-flex items-center gap-2 rounded-full border bg-white/70 px-3 py-1 text-[11.5px] font-medium uppercase tracking-[0.12em] text-ink-700"
              style={{ borderColor: "rgba(67,55,39,0.15)" }}
            >
              <Sparkles size={11} className="text-gold-400" />
              The multiplayer brain for AI-native teams
            </div>
            <h1 className="text-[clamp(36px,5.5vw,64px)] font-semibold leading-[1.02] tracking-[-0.02em] text-ink-900">
              Shared AI Memory for Engineering Teams
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-ink-700">
              Your <CyclingTool /> sessions share a project brain.{" "}
              <WavingText text="One engineer commits a decision" />
              {" "}— everyone's AI knows it.
            </p>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink-600">
              Context Cloud is an MCP memory server that gives your team's AI coding sessions persistent, structured memory. Unlike single-player memory tools, Context Cloud supports shared workspaces with role-based access, typed knowledge chunks (decisions, findings, conventions, state), automatic deduplication, and a{" "}
              <a href="https://contextcloud.pro" className="underline hover:text-ink-900">web dashboard</a>{" "}
              to browse and curate what your team's AI knows. Works with{" "}
              <a href="https://claude.ai" className="underline hover:text-ink-900">Claude</a>, Cursor, Codex, and Windsurf.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <SignUpButton mode="modal">
                <button
                  className="group flex items-center gap-2 rounded-md px-5 py-3 text-[14px] font-semibold text-cream-50 shadow-sm transition-all hover:shadow-md"
                  style={{
                    background: "linear-gradient(135deg,#3a3320,#5a4d36)",
                  }}
                >
                  Create Free Workspace
                  <ArrowRight
                    size={14}
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </button>
              </SignUpButton>
              <a
                href="#how"
                className="rounded-md border bg-white px-5 py-3 text-[14px] font-medium text-ink-800 transition-colors hover:bg-cream-100"
                style={{ borderColor: "rgba(67,55,39,0.18)" }}
              >
                See how it works
              </a>
            </div>
            <div className="mt-3 text-[12px] text-ink-500">
              Free forever. No credit card. Setup in 60 seconds.
            </div>
            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-ink-500">
              <span className="flex items-center gap-1.5">
                <Check size={12} className="text-[#5fa57a]" /> Claude
              </span>
              <span className="flex items-center gap-1.5">
                <Check size={12} className="text-[#5fa57a]" /> Claude Code
              </span>
              <span className="flex items-center gap-1.5">
                <Check size={12} className="text-[#5fa57a]" /> ChatGPT
              </span>
              <span className="flex items-center gap-1.5">
                <Check size={12} className="text-[#5fa57a]" /> Cursor
              </span>
              <span className="flex items-center gap-1.5">
                <Check size={12} className="text-[#5fa57a]" /> Codex
              </span>
            </div>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div
            className="relative aspect-square w-full max-w-[520px] mt-[52px] overflow-hidden rounded-2xl border shadow-xl"
            style={{
              borderColor: "rgba(67,55,39,0.10)",
            }}
          >
            <video
              autoPlay
              loop
              muted
              playsInline
              className="h-full w-full object-contain"
            >
              <source src="/context_remo_landing_page.webm" type="video/webm" />
              <source src="/context_remo_landing_page.mp4" type="video/mp4" />
            </video>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function CyclingTool() {
  const tools = ["Claude", "Cursor", "ChatGPT", "Codex"];
  const [index, setIndex] = useState(0);
  const [emStyle, setEmStyle] = useState<React.CSSProperties>({
    clipPath: "inset(0 100% 0 0)",
    transition: "none",
  });
  const measureRef = useRef<HTMLSpanElement>(null);
  const [slotWidth, setSlotWidth] = useState<number | undefined>(undefined);
  // Defer the first measurement until web fonts have loaded — otherwise
  // we'd capture the fallback font's width for "Claude" and the slot would
  // stay locked at that (wider) measurement after Inter swaps in, leaving
  // a visible gap between "Claude" and "every".
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts?.ready) {
      setFontsReady(true);
      return;
    }
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) setFontsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useLayoutEffect(() => {
    if (!fontsReady) return;
    if (measureRef.current) {
      setSlotWidth(measureRef.current.offsetWidth);
    }
  }, [index, fontsReady]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setEmStyle({
        clipPath: "inset(0 0 0 0)",
        transition: "clip-path 520ms cubic-bezier(0.65, 0, 0.35, 1)",
      });
    }, 80);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const timers: number[] = [];

    const cycle = () => {
      setEmStyle({
        clipPath: "inset(0 0 0 100%)",
        transition: "clip-path 380ms cubic-bezier(0.4, 0, 1, 1)",
      });

      timers.push(
        window.setTimeout(() => {
          setIndex((prev) => (prev + 1) % tools.length);
          setEmStyle({
            clipPath: "inset(0 100% 0 0)",
            transition: "none",
          });

          timers.push(
            window.setTimeout(() => {
              setEmStyle({
                clipPath: "inset(0 0 0 0)",
                transition: "clip-path 520ms cubic-bezier(0.65, 0, 0.35, 1)",
              });
            }, 24),
          );
        }, 400),
      );
    };

    const intervalId = window.setInterval(cycle, 2800);
    return () => {
      window.clearInterval(intervalId);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  return (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        verticalAlign: "baseline",
        width: slotWidth,
        transition: "width 520ms cubic-bezier(0.65, 0, 0.35, 1)",
      }}
    >
      <span
        ref={measureRef}
        aria-hidden="true"
        style={{ visibility: "hidden", whiteSpace: "nowrap" }}
      >
        {tools[index]}
      </span>
      <em
        className="not-italic"
        aria-live="polite"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          whiteSpace: "nowrap",
          color: "#a08665",
          willChange: "clip-path",
          ...emStyle,
        }}
      >
        {tools[index]}
      </em>
    </span>
  );
}

function WavingText({ text }: { text: string }) {
  const STAGGER_MS = 65;
  const RISE_MS = 600;
  const PAUSE_MS = 1800;
  const totalChars = text.replace(/\s/g, "").length;
  const duration = totalChars * STAGGER_MS + RISE_MS + PAUSE_MS;
  const peakPct = ((RISE_MS / 2) / duration) * 100;
  const restPct = (RISE_MS / duration) * 100;

  const words = text.split(" ");
  let charIndex = 0;

  return (
    <strong
      className="font-semibold text-ink-900"
      style={{ display: "inline" }}
    >
      <style>{`
        @keyframes cntxtWave {
          0% { transform: translateY(0); }
          ${peakPct.toFixed(2)}% { transform: translateY(-3px); }
          ${restPct.toFixed(2)}%, 100% { transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .cntxt-wave-char { animation: none !important; }
        }
      `}</style>
      {words.map((word, wi) => {
        const letters = word.split("").map((c) => {
          const idx = charIndex++;
          return (
            <span
              key={idx}
              className="cntxt-wave-char"
              style={{
                display: "inline-block",
                animation: `cntxtWave ${duration}ms cubic-bezier(0.4, 0, 0.4, 1) ${idx * STAGGER_MS}ms infinite`,
                willChange: "transform",
              }}
            >
              {c}
            </span>
          );
        });
        return (
          <Fragment key={wi}>
            <span style={{ display: "inline-block" }}>{letters}</span>
            {wi < words.length - 1 ? " " : null}
          </Fragment>
        );
      })}
    </strong>
  );
}

function BackgroundGlow() {
  return (
    <>
      <div
        className="pointer-events-none absolute -top-32 right-[-10%] -z-10 h-[420px] w-[520px] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, rgba(214,162,74,0.32), rgba(214,162,74,0))",
          filter: "blur(20px)",
        }}
      />
      <div
        className="pointer-events-none absolute -bottom-32 left-[-12%] -z-10 h-[420px] w-[520px] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, rgba(91,141,239,0.18), rgba(91,141,239,0))",
          filter: "blur(20px)",
        }}
      />
    </>
  );
}


function Services() {
  const services: Array<{
    icon: typeof Users;
    name: string;
    desc: string;
  }> = [
    {
      icon: Users,
      name: "Shared Team Workspaces",
      desc: "Invite teammates by email, role-based access control, attribution on every knowledge chunk.",
    },
    {
      icon: Layers,
      name: "Typed Knowledge Chunks",
      desc: "Decisions, findings, conventions, state, questions, references — not flat text.",
    },
    {
      icon: Globe,
      name: "Cross-Tool Support",
      desc: "Works with Claude (web, desktop, Code), Cursor, Codex, and Windsurf via MCP.",
    },
    {
      icon: BookOpen,
      name: "Web Dashboard",
      desc: "Browse, search, edit, and curate your team's knowledge with graph visualization.",
    },
    {
      icon: Search,
      name: "Hybrid Retrieval",
      desc: "Two-layer search: LLM knowledge base selection + vector/BM25/RRF fusion.",
    },
    {
      icon: Shield,
      name: "Automatic Deduplication",
      desc: "Conflicting or stale context gets resolved, not stacked.",
    },
  ];

  return (
    <section className="px-6 py-20" style={{ background: "rgba(247,241,227,0.45)" }}>
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <SectionHeading
            eyebrow="What Context Cloud provides"
            title="Everything your team's AI needs to remember."
          />
        </Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s, i) => (
            <Reveal key={s.name} delay={i * 60}>
              <div
                className="flex h-full flex-col rounded-[14px] border bg-white p-6 transition-all hover:-translate-y-0.5 hover:shadow-md"
                style={{ borderColor: "rgba(67,55,39,0.10)" }}
              >
                <div
                  className="mb-4 flex h-10 w-10 items-center justify-center rounded-[10px]"
                  style={{ background: "rgba(214,162,74,0.18)", color: "#9c7335" }}
                >
                  <s.icon size={17} />
                </div>
                <div className="text-[15px] font-semibold tracking-tight text-ink-900">
                  {s.name}
                </div>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-600">
                  {s.desc}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps: Array<{
    icon: typeof Zap;
    title: string;
    body: string;
    Demo: React.ComponentType<DemoProps>;
  }> = [
    {
      icon: Zap,
      title: "Connect in 60 seconds",
      body: "Copy one URL. Paste it in your tool's connector menu. That's it.",
      Demo: ConnectDemo,
    },
    {
      icon: Layers,
      title: 'Work and say "save this"',
      body: 'After key decisions or breakthroughs, just say "save this." Your AI captures the reasoning and context behind your work — not just what you decided, but why.',
      Demo: SaveDemo,
    },
    {
      icon: Brain,
      title: "Pick up in any tool",
      body: "Next session — same tool or different one — your AI knows what you decided and where you left off.",
      Demo: RecallDemo,
    },
  ];

  const [activeIndex, setActiveIndex] = useState(0);
  const advance = useCallback(() => {
    setActiveIndex((i) => (i + 1) % 3);
  }, []);

  // Only start cycling demos once the grid has scrolled into view.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setInView(entry.isIntersecting);
      },
      { threshold: 0.25 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section id="how" className="px-6 py-28">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <SectionHeading
            eyebrow="How it works"
            title="From context-blind to context-aware in three steps."
          />
        </Reveal>

        <div
          ref={gridRef}
          className="mt-14 grid gap-5 md:grid-cols-3"
        >
          {steps.map((s, i) => {
            const isActive = inView && activeIndex === i;
            return (
            <Reveal key={s.title} delay={i * 100}>
              <div
                className={`group relative flex h-full flex-col rounded-[14px] border bg-white p-7 ${
                  isActive ? "" : "hover:-translate-y-1 hover:shadow-md"
                }`}
                style={{
                  borderColor: isActive
                    ? "rgba(214,162,74,0.50)"
                    : "rgba(67,55,39,0.10)",
                  boxShadow: isActive
                    ? "0 26px 50px -20px rgba(58,51,32,0.40), 0 0 0 1px rgba(214,162,74,0.30)"
                    : undefined,
                  transform: isActive ? "translateY(-8px)" : undefined,
                  transition:
                    "transform 450ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 450ms ease, border-color 450ms ease",
                }}
              >
                <div
                  className="mb-5 flex h-10 w-10 items-center justify-center rounded-[10px] text-cream-50"
                  style={{
                    background: "linear-gradient(135deg,#3a3320,#5a4d36)",
                  }}
                >
                  <s.icon size={17} />
                </div>
                <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                  Step {i + 1}
                </div>
                <div className="text-[18px] font-semibold tracking-tight text-ink-900">
                  {s.title}
                </div>
                <p className="mt-2.5 text-[14px] leading-relaxed text-ink-600">
                  {s.body}
                </p>
                <div className="mt-auto pt-5">
                  <s.Demo
                    playing={isActive}
                    onComplete={advance}
                  />
                </div>
              </div>
            </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CntxtLogo({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      style={{ flexShrink: 0 }}
    >
      <line
        x1="30"
        y1="75"
        x2="50"
        y2="20"
        stroke="rgba(255,250,240,0.7)"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <line
        x1="50"
        y1="20"
        x2="78"
        y2="68"
        stroke="rgba(255,250,240,0.7)"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <line
        x1="78"
        y1="68"
        x2="30"
        y2="75"
        stroke="rgba(255,250,240,0.7)"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <circle cx="30" cy="75" r="10" fill="rgba(255,250,240,0.7)" />
      <circle cx="50" cy="20" r="14" fill="rgba(255,250,240,0.7)" />
      <circle cx="50" cy="20" r="6" fill="#2a2415" />
      <circle cx="78" cy="68" r="14" fill="rgba(255,250,240,0.7)" />
      <circle cx="78" cy="68" r="6" fill="#2a2415" />
    </svg>
  );
}

const DEMO_PRIMARY = "rgba(255,250,240,0.85)";
const DEMO_MUTED = "rgba(255,250,240,0.5)";
const DEMO_CONTAINER: React.CSSProperties = {
  background: "#2a2415",
  minHeight: "240px",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
};
const DEMO_TRANSITION = "opacity 400ms ease, transform 400ms ease";

function fadeIn(active: boolean): React.CSSProperties {
  return {
    opacity: active ? 1 : 0,
    transform: active ? "translateY(0)" : "translateY(6px)",
    transition: DEMO_TRANSITION,
  };
}

type DemoProps = { playing: boolean; onComplete: () => void };

function useLoopedSteps(
  delays: number[],
  playing: boolean,
  onComplete: () => void,
) {
  const [step, setStep] = useState(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!playing) {
      setStep(0);
      return;
    }

    const timeouts: ReturnType<typeof setTimeout>[] = [];
    delays.forEach((d, i) => {
      timeouts.push(
        setTimeout(() => {
          if (i === delays.length - 1) {
            setStep(0);
            onCompleteRef.current();
          } else {
            setStep(i);
          }
        }, d),
      );
    });

    return () => timeouts.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  return step;
}

function ConnectDemo({ playing, onComplete }: DemoProps) {
  // Steps:
  // 0: idle/waiting — URL bar visible (the starting frame between turns)
  // 1: copy icon flashes to check
  // 2: connector dialog fades in (empty fields)
  // 3: "Name" filled in
  // 4: "URL" filled in
  // 5: Connected confirmation
  // last: reset → onComplete
  const step = useLoopedSteps(
    [0, 1000, 1900, 2700, 3500, 4700, 6200],
    playing,
    onComplete,
  );
  const showUrl = step >= 0 && step < 5;
  const copied = step >= 1 && step < 5;
  const showDialog = step >= 2 && step < 5;
  const nameFilled = step >= 3 && step < 5;
  const urlFilled = step >= 4 && step < 5;
  const showConnected = step >= 5;

  return (
    <div
      className="overflow-hidden rounded-[10px] p-4"
      style={DEMO_CONTAINER}
    >
      <div style={fadeIn(showUrl && !showConnected)}>
        <div
          className="flex items-center justify-between rounded-[6px] px-2.5 py-1.5 font-mono"
          style={{
            background: "rgba(255,250,240,0.05)",
            border: "0.5px solid rgba(255,250,240,0.12)",
            fontSize: "11px",
            color: DEMO_PRIMARY,
          }}
        >
          <span className="truncate">
            https://api.contextcloud.pro/mcp/sse
          </span>
          <span
            className="ml-2 flex items-center gap-1"
            style={{ color: copied ? "#5fa57a" : DEMO_MUTED }}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
          </span>
        </div>
      </div>

      <div style={{ ...fadeIn(showDialog), marginTop: 10 }}>
        <div
          className="rounded-[6px] p-2.5"
          style={{
            background: "rgba(255,250,240,0.05)",
            border: "0.5px solid rgba(255,250,240,0.12)",
          }}
        >
          <div
            className="font-mono"
            style={{ fontSize: "10px", color: DEMO_MUTED, marginBottom: 6 }}
          >
            Add connector
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: "11px",
              color: nameFilled ? DEMO_PRIMARY : DEMO_MUTED,
              borderBottom: "0.5px solid rgba(255,250,240,0.12)",
              padding: "3px 0",
              marginBottom: 4,
            }}
          >
            Name: {nameFilled ? "Context Cloud" : ""}
            <span
              style={{
                opacity: nameFilled || !showDialog ? 0 : 1,
                marginLeft: 2,
              }}
            >
              |
            </span>
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: "11px",
              color: urlFilled ? DEMO_PRIMARY : DEMO_MUTED,
              borderBottom: "0.5px solid rgba(255,250,240,0.12)",
              padding: "3px 0",
            }}
          >
            URL: {urlFilled ? "https://api.contextcloud.pro/mcp/sse" : ""}
            <span
              style={{
                opacity: urlFilled || !nameFilled ? 0 : 1,
                marginLeft: 2,
              }}
            >
              |
            </span>
          </div>
        </div>
      </div>

      <div
        style={{
          ...fadeIn(showConnected),
          marginTop: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          color: "#5fa57a",
          fontSize: 12,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        <Check size={13} />
        Connected
      </div>
    </div>
  );
}

function WindowDots() {
  const dot: React.CSSProperties = {
    display: "inline-block",
    width: 4,
    height: 4,
    borderRadius: 9999,
    background: "rgba(255,250,240,0.25)",
  };
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      <span style={dot} />
      <span style={dot} />
      <span style={dot} />
    </span>
  );
}

function DemoBar({
  width,
  color,
}: {
  width: string;
  color?: string;
}) {
  return (
    <div
      style={{
        height: 4,
        width,
        borderRadius: 2,
        background: color ?? "rgba(255,250,240,0.18)",
        marginBottom: 5,
        transition: "width 500ms cubic-bezier(0.5, 0, 0.5, 1)",
      }}
    />
  );
}

function KnowledgeBase({
  active,
  accent,
  count,
}: {
  active: boolean;
  accent: string;
  count: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "rgba(255,250,240,0.05)",
        border: "0.5px solid rgba(255,250,240,0.12)",
        borderRadius: 6,
        padding: "7px 10px",
        boxShadow: active
          ? `0 0 0 1px ${accent}66, 0 0 18px ${accent}55`
          : "0 0 0 0 transparent",
        transition: "box-shadow 700ms ease",
      }}
    >
      <CntxtLogo size={13} />
      <span
        style={{
          fontSize: 11,
          color: DEMO_PRIMARY,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        Knowledge Base
      </span>
      <span
        style={{
          marginLeft: "auto",
          fontSize: 10.5,
          color: active ? accent : DEMO_MUTED,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontWeight: 500,
          transition: "color 400ms ease",
        }}
      >
        {count} chunks
      </span>
    </div>
  );
}

function Beam({
  height,
  active,
  accent,
}: {
  height: number;
  active: boolean;
  accent: string;
}) {
  return (
    <svg
      width="4"
      height={height}
      style={{
        position: "absolute",
        left: "50%",
        top: 0,
        marginLeft: -2,
        opacity: active ? 1 : 0.18,
        transition: "opacity 500ms ease",
      }}
    >
      <line
        x1="2"
        y1="0"
        x2="2"
        y2={height}
        stroke={accent}
        strokeWidth="1"
        strokeDasharray="3 3"
      />
    </svg>
  );
}

function TravelingChunk({
  travel,
  height,
  accent,
  reverse = false,
}: {
  travel: boolean;
  height: number;
  accent: string;
  reverse?: boolean;
}) {
  const startY = reverse ? height - 8 : 0;
  const endY = reverse ? 0 : height - 8;
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: 0,
        transform: `translate(-50%, ${travel ? endY : startY}px)`,
        width: 22,
        height: 8,
        borderRadius: 2,
        background: accent,
        boxShadow: `0 0 12px ${accent}99`,
        opacity: travel ? 1 : 0,
        transition:
          "transform 750ms cubic-bezier(0.4,0,0.6,1), opacity 250ms ease",
      }}
    />
  );
}

function SaveDemo({ playing, onComplete }: DemoProps) {
  // Steps:
  // 0: idle / chat bars type into the session
  // 1: save_memory action pulses gold inside the session
  // 2: beam activates + gold chunk travels down from session to KB
  // 3: KB receives — gold pulse, counter ticks 12 → 13
  // 4: "Saved to Context Cloud" indicator fades in
  // last: hold + reset → onComplete
  const step = useLoopedSteps(
    [0, 2000, 2900, 3800, 4700, 6300],
    playing,
    onComplete,
  );
  const pulseSave = step === 1;
  const beamActive = step >= 2;
  const traveling = step === 2;
  const kbActive = step >= 3;
  const showSaved = step >= 4;

  // Type the three session bars one at a time before the save action fires.
  const [barsTyped, setBarsTyped] = useState(0);
  useEffect(() => {
    if (!playing) {
      setBarsTyped(0);
      return;
    }
    if (step !== 0) return;
    setBarsTyped(0);
    const t1 = setTimeout(() => setBarsTyped(1), 300);
    const t2 = setTimeout(() => setBarsTyped(2), 800);
    const t3 = setTimeout(() => setBarsTyped(3), 1300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [step, playing]);

  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{ background: "#2a2415", padding: 14, minHeight: 240 }}
    >
      <div
        style={{
          background: "rgba(255,250,240,0.05)",
          border: "0.5px solid rgba(255,250,240,0.12)",
          borderRadius: 6,
          padding: "8px 10px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            paddingBottom: 6,
            marginBottom: 7,
            borderBottom: "0.5px solid rgba(255,250,240,0.08)",
          }}
        >
          <WindowDots />
          <span
            style={{
              fontSize: 9,
              color: DEMO_MUTED,
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, monospace",
              textTransform: "uppercase",
              letterSpacing: "0.10em",
            }}
          >
            active session
          </span>
        </div>
        <DemoBar width={barsTyped >= 1 ? "68%" : "0%"} />
        <DemoBar width={barsTyped >= 2 ? "52%" : "0%"} />
        <DemoBar width={barsTyped >= 3 ? "74%" : "0%"} />
        <div
          style={{
            marginTop: 4,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 8px",
            borderRadius: 4,
            background: pulseSave
              ? "rgba(214,162,74,0.18)"
              : "rgba(255,250,240,0.05)",
            border: pulseSave
              ? "0.5px solid rgba(214,162,74,0.55)"
              : "0.5px solid rgba(255,250,240,0.12)",
            boxShadow: pulseSave
              ? "0 0 14px rgba(214,162,74,0.45)"
              : "none",
            transition:
              "background 500ms ease, border-color 500ms ease, box-shadow 500ms ease",
          }}
        >
          <CntxtLogo size={11} />
          <span
            style={{
              fontSize: 10.5,
              color: pulseSave ? "#d6a24a" : DEMO_PRIMARY,
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, monospace",
              transition: "color 500ms ease",
            }}
          >
            save_memory
          </span>
        </div>
      </div>

      <div style={{ position: "relative", height: 48, margin: "10px 0" }}>
        <Beam height={48} active={beamActive} accent="#d6a24a" />
        <TravelingChunk
          travel={traveling}
          height={48}
          accent="#d6a24a"
        />
      </div>

      <KnowledgeBase
        active={kbActive}
        accent="#d6a24a"
        count={kbActive ? 13 : 12}
      />

      <div
        style={{
          ...fadeIn(showSaved),
          marginTop: 8,
          fontSize: 10.5,
          color: DEMO_MUTED,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <Check size={11} style={{ color: "#5fa57a" }} />
        Saved to Context Cloud
      </div>
    </div>
  );
}

function RecallDemo({ playing, onComplete }: DemoProps) {
  // Steps:
  // 0: idle — handoff bar + Cursor session, query types out
  // 1: search beam Cursor → KB activates
  // 2: KB pulses blue (match found)
  // 3: chunk travels back up to Cursor along return beam
  // 4: recalled content slots into the Cursor session
  // 5: AI follow-up line fades in below
  // last: hold + reset → onComplete
  const question = "Why JSONB for our schema?";
  const step = useLoopedSteps(
    [0, 1800, 2600, 3300, 4200, 5200, 7400],
    playing,
    onComplete,
  );
  const beamActive = step >= 1;
  const kbActive = step >= 2;
  const traveling = step === 3;
  const showContent = step >= 4;
  const showFollowup = step >= 5;

  const [typedChars, setTypedChars] = useState(0);
  useEffect(() => {
    if (!playing) {
      setTypedChars(0);
      return;
    }
    if (step !== 0) return;
    setTypedChars(0);
    const id = setInterval(() => {
      setTypedChars((c) => {
        if (c >= question.length) {
          clearInterval(id);
          return c;
        }
        return c + 1;
      });
    }, 55);
    return () => clearInterval(id);
  }, [step, playing]);
  const typedText = question.slice(0, typedChars);
  const stillTyping = typedChars < question.length;

  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{ background: "#2a2415", padding: 14, minHeight: 240 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          fontSize: 9,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          marginBottom: 6,
        }}
      >
        <span style={{ color: "rgba(255,250,240,0.45)" }}>Claude</span>
        <ArrowRight
          size={10}
          style={{ color: "rgba(255,250,240,0.40)" }}
        />
        <span style={{ color: "rgba(255,250,240,0.85)" }}>Cursor</span>
      </div>

      <div
        style={{
          background: "rgba(255,250,240,0.05)",
          border: "0.5px solid rgba(255,250,240,0.12)",
          borderRadius: 6,
          padding: "8px 10px",
          boxShadow: showContent
            ? "0 0 0 1px rgba(91,141,239,0.35)"
            : "none",
          transition: "box-shadow 600ms ease",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            paddingBottom: 5,
            marginBottom: 6,
            borderBottom: "0.5px solid rgba(255,250,240,0.08)",
          }}
        >
          <WindowDots />
          <span
            style={{
              fontSize: 9,
              color: DEMO_MUTED,
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, monospace",
              textTransform: "uppercase",
              letterSpacing: "0.10em",
            }}
          >
            cursor
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 7,
            minHeight: 14,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: "#5b8def",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontWeight: 600,
            }}
          >
            &gt;
          </span>
          <span
            style={{
              fontSize: 11,
              color: DEMO_PRIMARY,
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, monospace",
              whiteSpace: "pre",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            {typedText}
            {stillTyping && (
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 1,
                  height: 11,
                  background: DEMO_PRIMARY,
                  marginLeft: 1,
                  opacity: 0.85,
                }}
              />
            )}
          </span>
        </div>
        <div
          style={{
            background: "rgba(255,250,240,0.04)",
            borderLeft: "2.5px solid #5b8def",
            borderRadius: 3,
            padding: "5px 8px",
            opacity: showContent ? 1 : 0,
            transform: showContent ? "translateY(0)" : "translateY(-3px)",
            transition: "opacity 400ms ease, transform 400ms ease",
            minHeight: 32,
          }}
        >
          <div
            style={{
              fontSize: 9,
              color: DEMO_MUTED,
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, monospace",
              textTransform: "uppercase",
              letterSpacing: "0.10em",
              marginBottom: 2,
            }}
          >
            recalled
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: 11,
              lineHeight: 1.4,
              color: "rgba(255,250,240,0.92)",
            }}
          >
            JSONB — flexible schemas + team already on Postgres…
          </div>
        </div>
      </div>

      <div style={{ position: "relative", height: 28, margin: "6px 0" }}>
        <Beam height={28} active={beamActive} accent="#5b8def" />
        <TravelingChunk
          travel={traveling}
          height={28}
          accent="#5b8def"
          reverse
        />
      </div>

      <KnowledgeBase active={kbActive} accent="#5b8def" count={13} />

      <div
        style={{
          ...fadeIn(showFollowup),
          marginTop: 6,
          fontSize: 10.5,
          color: DEMO_PRIMARY,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        Want me to continue from that schema?
      </div>
    </div>
  );
}

function WhyContextCloud() {
  const pillars: Array<{
    icon: typeof Users;
    label: string;
    headline: string;
    body: string;
    illustration: React.ReactNode;
  }> = [
    {
      icon: Users,
      label: "Shared",
      headline: "AI shouldn't be single-player.",
      body: "Share a knowledge base with teammates. When your co-founder commits a decision in Claude, you see it in Cursor. One team, one brain, every tool.",
      illustration: <SharedIllustration />,
    },
    {
      icon: Globe,
      label: "Portable",
      headline: "Your context is trapped. We set it free.",
      body: "Built-in memory locks your knowledge inside one platform. Context Cloud works across Claude, Cursor, ChatGPT, and Codex with the same knowledge base.",
      illustration: <PortableIllustration />,
    },
    {
      icon: Code2,
      label: "Persistent",
      headline: "Your AI remembers decisions, not just preferences.",
      body: "Claude's built-in memory knows you like Postgres. Context Cloud knows WHY you chose Postgres, what schema you settled on, and which tradeoffs you considered.",
      illustration: <PersistentIllustration />,
    },
  ];
  return (
    <section
      id="why"
      className="px-6 py-28"
      style={{ background: "rgba(247,241,227,0.45)" }}
    >
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <SectionHeading
            eyebrow="Why Context Cloud"
            title="Memory for every teammate, every tool, every session."
          />
        </Reveal>
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {pillars.map((p, i) => (
            <Reveal key={p.label} delay={i * 80}>
              <div
                className="group relative h-full overflow-hidden rounded-[14px] border bg-white p-8 transition-all hover:-translate-y-0.5 hover:shadow-md"
                style={{
                  borderColor: "rgba(67,55,39,0.10)",
                  borderTop: "2px solid #d6a24a",
                }}
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-32"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(214,162,74,0.10) 0%, transparent 70%)",
                  }}
                />
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full opacity-50 transition-opacity group-hover:opacity-80"
                  style={{
                    background:
                      "radial-gradient(closest-side, rgba(214,162,74,0.22), transparent)",
                  }}
                />
                <div className="relative">
                  <div className="mb-5 flex h-32 items-center justify-center">
                    {p.illustration}
                  </div>
                  <div
                    className="mb-4 flex h-11 w-11 items-center justify-center rounded-[10px]"
                    style={{
                      background: "rgba(214,162,74,0.18)",
                      color: "#9c7335",
                    }}
                  >
                    <p.icon size={18} />
                  </div>
                  <div
                    className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: "#9c7335" }}
                  >
                    {p.label}
                  </div>
                  <div className="text-[17px] font-semibold leading-snug tracking-tight text-ink-900">
                    {p.headline}
                  </div>
                  <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-600">
                    {p.body}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function SharedIllustration() {
  const INK = "rgba(67,55,39,0.80)";
  const INK_BORDER = "rgba(67,55,39,0.28)";
  const INK_DOTTED = "rgba(67,55,39,0.32)";
  const SUBTLE_INK = "rgb(146,135,114)";
  return (
    <svg
      viewBox="0 0 280 128"
      width="100%"
      height="128"
      fill="none"
      style={{ maxWidth: 280 }}
    >
      {/* dotted line behind the cntxt node */}
      <line
        x1="76"
        y1="50"
        x2="204"
        y2="50"
        stroke={INK_DOTTED}
        strokeWidth="1.2"
        strokeDasharray="4 5"
      />

      {/* cntxt node at center — gold accent */}
      <g transform="translate(140, 50)">
        <circle r="15" fill="#fffaf0" stroke={INK_BORDER} strokeWidth="1.4" />
        <g transform="translate(-6.5, -6.5) scale(0.13)">
          <line x1="30" y1="75" x2="50" y2="20" stroke="#d6a24a" strokeWidth="10" strokeLinecap="round" />
          <line x1="50" y1="20" x2="78" y2="68" stroke="#d6a24a" strokeWidth="10" strokeLinecap="round" />
          <line x1="78" y1="68" x2="30" y2="75" stroke="#d6a24a" strokeWidth="10" strokeLinecap="round" />
          <circle cx="30" cy="75" r="11" fill="#d6a24a" />
          <circle cx="50" cy="20" r="15" fill="#d6a24a" />
          <circle cx="78" cy="68" r="15" fill="#d6a24a" />
        </g>
      </g>

      {/* Bob (left) */}
      <g>
        <circle cx="46" cy="50" r="24" fill="#fffaf0" stroke={INK_BORDER} strokeWidth="1.5" />
        <g transform="translate(46, 50)" fill={INK}>
          <circle cx="0" cy="-6" r="5" />
          <path d="M -10 11 Q -10 1 0 1 Q 10 1 10 11 Z" />
        </g>
        <text x="46" y="96" textAnchor="middle" fontSize="13" fontWeight="600" fill={INK}>
          Bob
        </text>
        <text x="46" y="113" textAnchor="middle" fontSize="10.5" fill={SUBTLE_INK}>
          on Claude
        </text>
      </g>

      {/* Jen (right) */}
      <g>
        <circle cx="234" cy="50" r="24" fill="#fffaf0" stroke={INK_BORDER} strokeWidth="1.5" />
        <g transform="translate(234, 50)" fill={INK}>
          <circle cx="0" cy="-6" r="5" />
          <path d="M -10 11 Q -10 1 0 1 Q 10 1 10 11 Z" />
        </g>
        <text x="234" y="96" textAnchor="middle" fontSize="13" fontWeight="600" fill={INK}>
          Jen
        </text>
        <text x="234" y="113" textAnchor="middle" fontSize="10.5" fill={SUBTLE_INK}>
          on Cursor
        </text>
      </g>
    </svg>
  );
}

function PortableIllustration() {
  const TILE_BG = "#fffaf0";
  const TILE_BORDER = "rgba(67,55,39,0.22)";
  const THREAD = "rgba(67,55,39,0.30)";
  const ICON = "rgba(58,51,32,0.92)";
  // Tile geometry: 40x40 tiles at y=24, evenly spaced across 280-wide viewBox.
  // 4 tiles × 40 = 160; remaining 120 is split into 3 gaps + 2 outer margins of 24 each.
  const TILE = 40;
  const Y = 24;
  const xs = [24, 88, 152, 216];

  // Each logo is from its source's native 24x24 viewBox. Scale 24 → 22 to fit
  // inside the 40x40 tile with 9px padding (centered).
  const logoTransform = (x: number) =>
    `translate(${x + 9}, ${Y + 9}) scale(${22 / 24})`;

  return (
    <svg
      viewBox="0 0 280 112"
      width="100%"
      height="112"
      fill="none"
      style={{ maxWidth: 280 }}
    >
      {/* Thread connecting all four platform tiles */}
      <line
        x1={xs[0] + TILE}
        y1={Y + TILE / 2}
        x2={xs[3]}
        y2={Y + TILE / 2}
        stroke={THREAD}
        strokeWidth="1.2"
      />

      {/* Tile 1 — Claude (Anthropic) */}
      <g>
        <rect
          x={xs[0]}
          y={Y}
          width={TILE}
          height={TILE}
          rx="9"
          fill={TILE_BG}
          stroke={TILE_BORDER}
          strokeWidth="1.2"
        />
        <g transform={logoTransform(xs[0])} fill={ICON}>
          <path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" />
        </g>
        <text x={xs[0] + TILE / 2} y={Y + TILE + 16} textAnchor="middle" fontSize="10" fill="rgb(146,135,114)">
          Claude
        </text>
      </g>

      {/* Tile 2 — Cursor */}
      <g>
        <rect
          x={xs[1]}
          y={Y}
          width={TILE}
          height={TILE}
          rx="9"
          fill={TILE_BG}
          stroke={TILE_BORDER}
          strokeWidth="1.2"
        />
        <g transform={logoTransform(xs[1])} fill={ICON}>
          <path d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23" />
        </g>
        <text x={xs[1] + TILE / 2} y={Y + TILE + 16} textAnchor="middle" fontSize="10" fill="rgb(146,135,114)">
          Cursor
        </text>
      </g>

      {/* Tile 3 — ChatGPT (OpenAI) */}
      <g>
        <rect
          x={xs[2]}
          y={Y}
          width={TILE}
          height={TILE}
          rx="9"
          fill={TILE_BG}
          stroke={TILE_BORDER}
          strokeWidth="1.2"
        />
        <g transform={logoTransform(xs[2])} fill={ICON}>
          <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
        </g>
        <text x={xs[2] + TILE / 2} y={Y + TILE + 16} textAnchor="middle" fontSize="10" fill="rgb(146,135,114)">
          ChatGPT
        </text>
      </g>

      {/* Tile 4 — Codex (no widely-recognized brand mark; use a code-bracket glyph) */}
      <g>
        <rect
          x={xs[3]}
          y={Y}
          width={TILE}
          height={TILE}
          rx="9"
          fill={TILE_BG}
          stroke={TILE_BORDER}
          strokeWidth="1.2"
        />
        <g
          transform={`translate(${xs[3] + TILE / 2}, ${Y + TILE / 2})`}
          stroke={ICON}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        >
          <polyline points="-5,-6 -10,0 -5,6" />
          <polyline points="5,-6 10,0 5,6" />
          <line x1="-2.5" y1="7" x2="2.5" y2="-7" />
        </g>
        <text x={xs[3] + TILE / 2} y={Y + TILE + 16} textAnchor="middle" fontSize="10" fill="rgb(146,135,114)">
          Codex
        </text>
      </g>
    </svg>
  );
}

function PersistentIllustration() {
  return (
    <svg
      viewBox="0 0 220 128"
      width="100%"
      height="128"
      fill="none"
      style={{ maxWidth: 220 }}
    >
      {/* Back card — faintest layer */}
      <rect
        x="80"
        y="16"
        width="108"
        height="62"
        rx="9"
        fill="rgba(67,55,39,0.10)"
      />
      {/* Middle card */}
      <rect
        x="66"
        y="28"
        width="108"
        height="62"
        rx="9"
        fill="rgba(67,55,39,0.18)"
      />
      {/* Front card — cream surface with gold accent border + ink content lines */}
      <g>
        <rect
          x="52"
          y="40"
          width="108"
          height="68"
          rx="9"
          fill="#fffaf0"
          stroke="rgba(214,162,74,0.65)"
          strokeWidth="1.5"
        />
        <rect
          x="66"
          y="58"
          width="64"
          height="3.5"
          rx="1.75"
          fill="rgba(67,55,39,0.60)"
        />
        <rect
          x="66"
          y="70"
          width="80"
          height="3.5"
          rx="1.75"
          fill="rgba(67,55,39,0.42)"
        />
        <rect
          x="66"
          y="82"
          width="48"
          height="3.5"
          rx="1.75"
          fill="rgba(67,55,39,0.28)"
        />
      </g>
    </svg>
  );
}

type CellTone = "yes" | "partial" | "no";

type Row = {
  feature: string;
  manual: { text: string; tone: CellTone };
  builtin: { text: string; tone: CellTone };
  cntxt: { text: string; tone: CellTone };
};

function Comparison() {
  const rows: Row[] = [
    {
      feature: "Persists across sessions",
      manual: { text: "Sort of — you maintain it", tone: "partial" },
      builtin: { text: "Yes", tone: "yes" },
      cntxt: { text: "Yes", tone: "yes" },
    },
    {
      feature: "Works across tools",
      manual: { text: "Manual copy to each", tone: "partial" },
      builtin: { text: "No — locked to one platform", tone: "no" },
      cntxt: {
        text: "Yes — Claude, Cursor, ChatGPT, Codex",
        tone: "yes",
      },
    },
    {
      feature: "Shared with teammates",
      manual: { text: "Via git, if you remember", tone: "partial" },
      builtin: { text: "No", tone: "no" },
      cntxt: { text: "Yes — real-time, role-based", tone: "yes" },
    },
    {
      feature: "Structured context",
      manual: { text: "No — flat text", tone: "no" },
      builtin: { text: "No — flat preferences", tone: "no" },
      cntxt: {
        text: "Yes — captures reasoning, not just facts",
        tone: "yes",
      },
    },
    {
      feature: "Searchable by AI",
      manual: { text: "No", tone: "no" },
      builtin: { text: "Limited", tone: "partial" },
      cntxt: { text: "Yes — hybrid semantic + keyword", tone: "yes" },
    },
    {
      feature: "Setup time",
      manual: { text: "Ongoing maintenance", tone: "no" },
      builtin: { text: "Automatic", tone: "yes" },
      cntxt: { text: "60 seconds", tone: "yes" },
    },
  ];

  return (
    <section className="px-6 py-28">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <SectionHeading
            eyebrow="How it compares"
            title="Not all memory is created equal."
          />
        </Reveal>
        <Reveal delay={80}>
          <div
            className="mt-14 overflow-hidden rounded-[14px] border bg-white"
            style={{
              borderColor: "rgba(67,55,39,0.14)",
              boxShadow: "0 24px 60px -32px rgba(58,51,32,0.28)",
            }}
          >
            <div className="overflow-x-auto">
              <table
                className="w-full min-w-[640px] border-collapse text-left"
                style={{ borderSpacing: 0 }}
              >
                <thead>
                  <tr>
                    <th
                      className="px-5 py-4 align-bottom text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-500"
                      style={{
                        borderBottom: "1px solid rgba(67,55,39,0.20)",
                        background: "rgba(247,241,227,0.55)",
                        width: "26%",
                      }}
                    >
                      Feature
                    </th>
                    <ComparisonHeader
                      label="Manual"
                      sub="CLAUDE.md, copy-paste"
                    />
                    <ComparisonHeader
                      label="Built-in memory"
                      sub="Claude, ChatGPT"
                    />
                    <ComparisonHeader
                      label="Context Cloud"
                      sub="The full picture"
                      highlight
                    />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const isLast = i === rows.length - 1;
                    return (
                      <tr key={r.feature}>
                        <td
                          className="px-5 py-3.5 text-[13.5px] font-medium text-ink-800"
                          style={{
                            borderBottom: isLast
                              ? "none"
                              : "1px solid rgba(67,55,39,0.10)",
                            background: "rgba(247,241,227,0.30)",
                          }}
                        >
                          {r.feature}
                        </td>
                        <ComparisonCell cell={r.manual} isLast={isLast} />
                        <ComparisonCell cell={r.builtin} isLast={isLast} />
                        <ComparisonCell
                          cell={r.cntxt}
                          isLast={isLast}
                          highlight
                        />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Reveal>
        <Reveal delay={120}>
          <div className="mt-6 text-center">
            <a
              href="/blog/best-mcp-memory-servers-for-teams/"
              className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-700 transition-colors hover:text-ink-900"
            >
              Read the full comparison <ArrowRight size={13} />
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function ComparisonHeader({
  label,
  sub,
  highlight,
}: {
  label: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <th
      className="px-5 py-4 align-bottom"
      style={{
        borderBottom: highlight
          ? "1px solid rgba(214,162,74,0.55)"
          : "1px solid rgba(67,55,39,0.20)",
        background: highlight
          ? "rgba(214,162,74,0.18)"
          : "rgba(247,241,227,0.55)",
        width: "24.6%",
      }}
    >
      <div
        className="text-[12px] font-semibold uppercase tracking-[0.12em]"
        style={{ color: highlight ? "#9c7335" : "rgb(120,108,87)" }}
      >
        {label}
      </div>
      <div
        className="mt-1 text-[11px] font-normal normal-case tracking-normal"
        style={{ color: highlight ? "rgba(156,115,53,0.75)" : "rgb(146,135,114)" }}
      >
        {sub}
      </div>
    </th>
  );
}

function ComparisonCell({
  cell,
  highlight,
  isLast,
}: {
  cell: { text: string; tone: CellTone };
  highlight?: boolean;
  isLast?: boolean;
}) {
  const color =
    cell.tone === "yes"
      ? "#3f8f5a"
      : cell.tone === "partial"
        ? "#c08a2a"
        : "rgb(140,128,107)";
  return (
    <td
      className="px-5 py-3.5 text-[13.5px]"
      style={{
        borderBottom: isLast ? "none" : "1px solid rgba(67,55,39,0.10)",
        background: highlight ? "rgba(214,162,74,0.12)" : "transparent",
        color,
        fontWeight: highlight ? 600 : 500,
      }}
    >
      {cell.text}
    </td>
  );
}

function Pricing() {
  const features = [
    "Unlimited knowledge bases",
    "All tools — Claude, Cursor, ChatGPT, Codex",
    "Full dashboard & session history",
    "Shared workspaces & team retrieval",
    "Document upload (PDF, DOCX, MD…)",
    "No credit card required",
  ];

  return (
    <section
      id="pricing"
      className="px-6 py-28"
      style={{ background: "rgba(247,241,227,0.45)" }}
    >
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <SectionHeading
            eyebrow="Pricing"
            title="Free. Actually free."
          />
        </Reveal>

        <Reveal delay={80}>
          <div
            className="mx-auto mt-14 max-w-3xl rounded-[18px] border bg-white p-10 text-center"
            style={{
              borderColor: "rgba(214,162,74,0.4)",
              boxShadow: "0 30px 60px -30px rgba(214,162,74,0.45)",
            }}
          >
            <div className="text-[72px] font-semibold leading-none tracking-tight text-ink-900">
              $0
            </div>
            <div className="mt-3 text-[15px] text-ink-600">
              Everything. No limits. No catch.
            </div>

            <ul className="mx-auto mt-8 grid max-w-xl gap-3 text-left sm:grid-cols-2">
              {features.map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-2 text-[13.5px] text-ink-700"
                >
                  <Check
                    size={14}
                    className="mt-1 shrink-0 text-[#5fa57a]"
                  />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <div className="mt-9 flex justify-center">
              <SignUpButton mode="modal">
                <button
                  className="group flex items-center gap-2 rounded-md px-5 py-3 text-[14px] font-semibold text-cream-50 shadow-sm transition-all hover:shadow-md"
                  style={{
                    background: "linear-gradient(135deg,#3a3320,#5a4d36)",
                  }}
                >
                  Create Free Workspace
                  <ArrowRight
                    size={14}
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </button>
              </SignUpButton>
            </div>

            <div className="mx-auto mt-5 max-w-md text-[12px] text-ink-400">
              We keep costs near zero because Context Cloud has no server-side
              LLM costs. Your AI tool does the thinking. We just remember.
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "What is the best MCP memory server for teams?",
    a: "Context Cloud is the only MCP memory server with shared team workspaces. It provides role-based access, typed knowledge (decisions, findings, conventions, state), cross-tool support, and a web dashboard. Free tier available at contextcloud.pro.",
  },
  {
    q: "How do I share AI context between team members?",
    a: "Invite teammates to a Context Cloud workspace by email. When one engineer's AI commits knowledge, any teammate's AI recalls it instantly across Claude Code, Cursor, Codex, or any MCP-compatible tool.",
  },
  {
    q: "How does Context Cloud compare to mem0 and Basic Memory?",
    a: "mem0 and Basic Memory are single-user. Context Cloud adds shared team workspaces with RBAC, typed knowledge structure, attribution tracking, automatic deduplication, and a web dashboard for engineering teams.",
  },
  {
    q: "Does Context Cloud work with Claude Code and Cursor?",
    a: "Yes. Context Cloud works with Claude (web, desktop, and Code), Cursor, Codex, Windsurf, and any MCP-compatible client. Connect at api.contextcloud.pro/mcp/protocol or via @contextcloud/mcp-client.",
  },
  {
    q: "What is an MCP memory server?",
    a: "An MCP memory server gives AI coding assistants persistent memory that survives between sessions. Instead of losing context when you close a session, it stores knowledge for future sessions.",
  },
];

function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  return (
    <section id="faq" className="px-6 py-28">
      <div className="mx-auto max-w-3xl">
        <Reveal>
          <SectionHeading
            eyebrow="FAQ"
            title="Frequently asked questions"
          />
        </Reveal>

        <Reveal delay={80}>
          <ul
            className="mt-12 overflow-hidden rounded-[14px] border bg-white"
            style={{ borderColor: "rgba(67,55,39,0.10)" }}
          >
            {FAQ_ITEMS.map((item, i) => {
              const open = openIndex === i;
              return (
                <li
                  key={item.q}
                  style={{
                    borderTop:
                      i === 0 ? "none" : "0.5px solid rgba(67,55,39,0.10)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setOpenIndex(open ? null : i)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left transition-colors hover:bg-cream-50"
                  >
                    <span className="text-[14.5px] font-semibold tracking-tight text-ink-900">
                      {item.q}
                    </span>
                    <ChevronDown
                      size={16}
                      className="shrink-0 text-ink-500 transition-transform"
                      style={{
                        transform: open ? "rotate(180deg)" : "rotate(0deg)",
                      }}
                    />
                  </button>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateRows: open ? "1fr" : "0fr",
                      transition:
                        "grid-template-rows 300ms cubic-bezier(0.16,1,0.3,1)",
                    }}
                  >
                    <div style={{ overflow: "hidden" }}>
                      <p className="px-6 pb-5 text-[13.5px] leading-relaxed text-ink-700">
                        {item.a}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

function ClosingCTA() {
  return (
    <section className="px-6 py-28">
      <div className="mx-auto max-w-3xl text-center">
        <Reveal>
          <h2 className="text-[clamp(24px,3.5vw,36px)] font-semibold leading-tight tracking-[-0.02em] text-ink-900">
            Everyone builds single-player memory. We built{" "}
            <em className="not-italic" style={{ color: "#a08665" }}>
              multiplayer
            </em>
            .
          </h2>
        </Reveal>
        <Reveal delay={80}>
          <div className="mt-8 flex justify-center">
            <SignUpButton mode="modal">
              <button
                className="group flex items-center gap-2 rounded-md px-5 py-3 text-[14px] font-semibold text-cream-50 shadow-sm transition-all hover:shadow-md"
                style={{
                  background: "linear-gradient(135deg,#3a3320,#5a4d36)",
                }}
              >
                Create Free Workspace
                <ArrowRight
                  size={14}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </button>
            </SignUpButton>
          </div>
          <div className="mt-3 text-[12px] text-ink-500">
            Free forever. Setup in 60 seconds.
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function About() {
  return (
    <section className="px-6 py-16" style={{ background: "rgba(247,241,227,0.45)" }}>
      <div className="mx-auto max-w-3xl">
        <Reveal>
          <h3 className="text-[18px] font-semibold tracking-tight text-ink-900">
            About Context Cloud
          </h3>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-700">
            Built by{" "}
            <a href="https://github.com/abhinavala" className="underline hover:text-ink-900">Abhi</a>
            {" "}— a CS student at Santa Clara University and founder building at the intersection of AI infrastructure and developer tooling. Context Cloud was built using itself: every architecture decision and convention in the codebase lives in a shared Context Cloud workspace.
          </p>
          <p className="mt-4 text-[13px] text-ink-600">
            Questions?{" "}
            <a href="mailto:abhi@contextcloud.pro" className="underline hover:text-ink-900">
              abhi@contextcloud.pro
            </a>
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer
      className="px-6 py-12"
      style={{ borderTop: "0.5px solid rgba(67,55,39,0.12)" }}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-6 md:flex-row md:items-center">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[12px] font-bold tracking-wider text-cream-50"
            style={{ background: "linear-gradient(135deg,#3a3320,#5a4d36)" }}
          >
            cn
          </div>
          <div>
            <div className="text-[14px] font-semibold tracking-tight">Context Cloud</div>
            <div className="text-[11.5px] text-ink-500">
              <a href="mailto:abhi@contextcloud.pro" className="hover:text-ink-900">abhi@contextcloud.pro</a>
            </div>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-5 text-[12.5px] text-ink-600">
          <a
            href="/privacy"
            className="transition-colors hover:text-ink-900"
          >
            Privacy Policy
          </a>
          <a
            href="https://docs.contextcloud.pro"
            className="inline-flex items-center gap-1 transition-colors hover:text-ink-900"
          >
            <BookOpen size={11} /> Documentation
          </a>
          <a
            href="https://github.com/abhinavala/cntxtv2"
            className="transition-colors hover:text-ink-900"
          >
            GitHub
          </a>
          <a
            href="/blog/"
            className="transition-colors hover:text-ink-900"
          >
            Blog
          </a>
        </nav>

        <div className="text-[11.5px] text-ink-500">© 2026 Context Cloud</div>
      </div>
    </footer>
  );
}

function SectionHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-400">
        {eyebrow}
      </div>
      <h2 className="text-[clamp(28px,4vw,42px)] font-semibold leading-[1.1] tracking-[-0.02em] text-ink-900">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-4 text-[15px] leading-relaxed text-ink-600">
          {subtitle}
        </p>
      )}
    </div>
  );
}

function Reveal({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            obs.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "translateY(0)" : "translateY(14px)",
        transition: `opacity 600ms ease ${delay}ms, transform 600ms cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}
