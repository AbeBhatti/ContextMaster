import { ArrowLeft, BookOpen } from "lucide-react";

export function PrivacyPolicyPage() {
  return (
    <div
      className="h-screen w-screen overflow-y-auto bg-cream-50 text-ink-900"
      style={{ scrollBehavior: "smooth" }}
    >
      <Nav />
      <main className="px-6 pb-24 pt-16 sm:pt-20">
        <article className="mx-auto w-full max-w-3xl">
          <header className="mb-10">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-400">
              Privacy
            </div>
            <h1 className="text-[clamp(32px,5vw,48px)] font-semibold leading-[1.05] tracking-[-0.02em] text-ink-900">
              Privacy Policy
            </h1>
            <p className="mt-3 text-[13.5px] text-ink-500">
              Last updated: May 2026
            </p>
          </header>

          <Lede>
            ContextMaster ("we", "us", "our") operates contextcloud.pro and the ContextMaster
            API. This policy explains how we collect, use, and protect your
            information.
          </Lede>

          <Section title="What We Collect">
            <BulletList>
              <li>
                <Strong>Account information:</Strong> email address and name
                (via Clerk authentication)
              </li>
              <li>
                <Strong>Knowledge data:</Strong> the decisions, findings,
                conventions, and other knowledge you save through your AI tools
              </li>
              <li>
                <Strong>Documents:</Strong> files you upload for processing
                (PDFs, DOCX, TXT, MD, CSV)
              </li>
              <li>
                <Strong>Usage data:</Strong> session timestamps, tool used,
                workspace activity
              </li>
            </BulletList>
          </Section>

          <Section title="How We Use Your Data">
            <BulletList>
              <li>
                To provide the ContextMaster service: storing, retrieving, and managing
                your knowledge bases
              </li>
              <li>
                To generate text embeddings of your content for semantic search
                (via OpenAI's embedding API — see Third-Party Services below)
              </li>
              <li>
                To send transactional emails (workspace invites via Resend)
              </li>
              <li>
                To improve the service based on aggregate usage patterns
              </li>
            </BulletList>
          </Section>

          <Section title="Third-Party Services">
            <BulletList>
              <li>
                <Strong>Clerk (clerk.com):</Strong> Authentication and user
                management. Clerk processes your email and login credentials.
                See Clerk's privacy policy.
              </li>
              <li>
                <Strong>OpenAI (openai.com):</Strong> We send your knowledge
                chunk text to OpenAI's embedding API (text-embedding-3-small) to
                generate vector embeddings for search. OpenAI does not use API
                data for training. We do <Strong>NOT</Strong> send your data to
                any LLM for generation — your AI tool handles that directly.
              </li>
              <li>
                <Strong>Supabase (supabase.com):</Strong> Database hosting. Your
                data is stored in Supabase's managed PostgreSQL infrastructure.
              </li>
              <li>
                <Strong>Resend (resend.com):</Strong> Transactional email
                delivery for workspace invites.
              </li>
              <li>
                <Strong>Railway (railway.app):</Strong> API server hosting.
              </li>
              <li>
                <Strong>Vercel (vercel.com):</Strong> Dashboard hosting.
              </li>
            </BulletList>
          </Section>

          <Section title="Data Storage and Security">
            <BulletList>
              <li>
                All data is stored in Supabase's managed PostgreSQL database
                with encryption at rest
              </li>
              <li>API communication is encrypted via HTTPS/TLS</li>
              <li>
                Authentication uses industry-standard OAuth 2.1 and JWT
                verification
              </li>
              <li>
                Workspace permissions (owner/editor/viewer) enforce access
                control
              </li>
              <li>We do not sell your data to third parties</li>
            </BulletList>
          </Section>

          <Section title="Data Retention">
            <BulletList>
              <li>
                Your knowledge data is retained as long as your account is
                active
              </li>
              <li>Archived chunks are soft-deleted and can be restored</li>
              <li>
                When you delete a knowledge base, its data is permanently
                removed
              </li>
              <li>Account deletion removes all associated data</li>
            </BulletList>
          </Section>

          <Section title="Your Rights">
            <BulletList>
              <li>
                You can view, edit, and delete your knowledge at any time
                through the dashboard
              </li>
              <li>You can export your data by browsing your knowledge bases</li>
              <li>You can delete your account by contacting us</li>
              <li>
                You can revoke AI tool access by removing the connector from
                your AI tool's settings
              </li>
            </BulletList>
          </Section>

          <Section title="Workspace and Team Data">
            <BulletList>
              <li>
                Workspace owners control who has access to shared knowledge
              </li>
              <li>
                Team members can only access workspaces they've been invited to
              </li>
              <li>Removing a member revokes their access immediately</li>
              <li>
                Organization shared knowledge bases are accessible to all org
                members
              </li>
            </BulletList>
          </Section>

          <Section title="Contact">
            <p>
              For privacy questions or data requests, contact:{" "}
              <a
                href="mailto:abhi@contextcloud.pro"
                className="font-medium text-ink-900 underline decoration-ink-300 underline-offset-2 hover:decoration-ink-700"
              >
                abhi@contextcloud.pro
              </a>
            </p>
          </Section>

          <Section title="Changes to This Policy">
            <p>
              We may update this policy from time to time. We will notify users
              of material changes via email or dashboard notification.
            </p>
          </Section>
        </article>
      </main>
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header
      className="sticky top-0 z-50 w-full"
      style={{
        background: "rgba(255,255,255,0.85)",
        backdropFilter: "saturate(140%) blur(10px)",
        borderBottom: "0.5px solid rgba(24,24,27,0.10)",
      }}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3.5">
        <a href="/" className="flex items-center gap-2.5">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[12px] font-bold tracking-wider text-cream-50"
            style={{ background: "#3d5a80" }}
          >
            cn
          </div>
          <div className="text-[15px] font-semibold tracking-tight">ContextMaster</div>
        </a>
        <a
          href="/"
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium text-ink-700 transition-colors hover:bg-cream-200 hover:text-ink-900"
        >
          <ArrowLeft size={12} />
          Back to home
        </a>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer
      className="px-6 py-12"
      style={{ borderTop: "0.5px solid rgba(24,24,27,0.12)" }}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-6 md:flex-row md:items-center">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[12px] font-bold tracking-wider text-cream-50"
            style={{ background: "#3d5a80" }}
          >
            cn
          </div>
          <div>
            <div className="text-[14px] font-semibold tracking-tight">ContextMaster</div>
            <div className="text-[11.5px] text-ink-500">Built by Abhi</div>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-5 text-[12.5px] text-ink-600">
          <a href="/privacy" className="transition-colors hover:text-ink-900">
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
        </nav>

        <div className="text-[11.5px] text-ink-500">© 2026 ContextMaster</div>
      </div>
    </footer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-[20px] font-semibold tracking-tight text-ink-900">
        {title}
      </h2>
      <div className="mt-3 text-[14.5px] leading-relaxed text-ink-700">
        {children}
      </div>
    </section>
  );
}

function Lede({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[15px] leading-relaxed text-ink-700">{children}</p>
  );
}

function BulletList({ children }: { children: React.ReactNode }) {
  return (
    <ul className="ml-5 flex list-disc flex-col gap-2 marker:text-ink-400">
      {children}
    </ul>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-ink-900">{children}</span>;
}
