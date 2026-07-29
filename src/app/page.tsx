import { redirect } from "next/navigation";
import { auth, linkedInConfigured } from "@/auth";
import { signInDemo, signInWithLinkedIn } from "@/app/actions";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  const params = await searchParams;
  const error = params.error;

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute -left-24 top-24 h-72 w-72 rounded-full bg-[#9ec5e8]/30 blur-3xl animate-drift" />
        <div
          className="absolute right-0 top-40 h-96 w-96 rounded-full bg-[#b7d4ef]/25 blur-3xl animate-drift"
          style={{ animationDelay: "1.5s" }}
        />
      </div>

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 animate-fade">
        <div className="text-2xl font-semibold tracking-tight text-ink">
          Link<span className="text-accent">Keep</span>
        </div>
        <p className="hidden text-sm text-muted sm:block">
          Your LinkedIn relationships, organized
        </p>
      </header>

      <section className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-6 pb-16 pt-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="animate-rise">
          <p className="mb-4 font-serif text-lg text-accent-deep">LinkKeep</p>
          <h1 className="max-w-xl font-serif text-4xl leading-tight text-ink sm:text-5xl lg:text-[3.4rem]">
            Know who matters in your network — and follow up on purpose.
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-ink-soft">
            Connect with LinkedIn, import your connections, then tag, note, and
            track relationships in one place.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {linkedInConfigured ? (
              <form action={signInWithLinkedIn}>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-deep"
                >
                  <LinkedInIcon />
                  Connect LinkedIn
                </button>
              </form>
            ) : (
              <>
                <form action={signInDemo}>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-deep"
                  >
                    Try demo workspace
                  </button>
                </form>
                <a
                  href="#setup"
                  className="rounded-md border border-line bg-white/70 px-5 py-3 text-sm font-semibold text-ink-soft transition hover:border-accent hover:text-accent"
                >
                  Set up LinkedIn OAuth
                </a>
              </>
            )}
          </div>

          {error ? (
            <p className="mt-4 text-sm text-danger">
              {error === "linkedin_not_configured"
                ? "Add AUTH_LINKEDIN_ID and AUTH_LINKEDIN_SECRET to .env.local first."
                : decodeURIComponent(error)}
            </p>
          ) : null}

          <p className="mt-6 max-w-md text-sm leading-relaxed text-muted">
            LinkedIn only self-serves Sign In. Listing connections via API needs
            partner approval — so LinkKeep also imports LinkedIn&apos;s official
            Connections.csv export.
          </p>
        </div>

        <div
          className="animate-rise relative overflow-hidden rounded-2xl border border-white/60 bg-white/70 p-6 shadow-[0_30px_80px_-40px_rgba(11,31,51,0.45)] backdrop-blur"
          style={{ animationDelay: "0.15s" }}
        >
          <div
            className="absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage:
                "linear-gradient(135deg, transparent 40%, #d7e8f7 40%, #d7e8f7 42%, transparent 42%), linear-gradient(0deg, #f8fbff, transparent)",
            }}
          />
          <div className="relative space-y-4">
            <PreviewRow
              name="Maya Chen"
              meta="Product · Stripe"
              tag="Investor intro"
              status="Warm"
            />
            <PreviewRow
              name="Jordan Blake"
              meta="Eng Manager · Notion"
              tag="Hiring"
              status="Active"
            />
            <PreviewRow
              name="Priya Nair"
              meta="Founder · Lattice Labs"
              tag="Follow up"
              status="Cold"
            />
            <div className="rounded-xl border border-line bg-paper px-4 py-3 text-sm text-ink-soft">
              Notes, tags, and last-contacted dates stay private on your machine.
            </div>
          </div>
        </div>
      </section>

      {!linkedInConfigured ? (
        <section
          id="setup"
          className="relative z-10 border-t border-line/80 bg-white/50"
        >
          <div className="mx-auto max-w-6xl px-6 py-12 animate-fade">
            <h2 className="font-serif text-2xl text-ink">
              Connect your LinkedIn account
            </h2>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-ink-soft">
              <li>
                Create an app at{" "}
                <a
                  className="text-accent underline-offset-2 hover:underline"
                  href="https://www.linkedin.com/developers/apps"
                  target="_blank"
                  rel="noreferrer"
                >
                  linkedin.com/developers/apps
                </a>
              </li>
              <li>
                Products → request{" "}
                <strong>Sign In with LinkedIn using OpenID Connect</strong>
              </li>
              <li>
                Auth → add redirect URL{" "}
                <code className="rounded bg-paper-2 px-1.5 py-0.5 text-sm">
                  http://localhost:3000/api/auth/callback/linkedin
                </code>
              </li>
              <li>
                Copy Client ID &amp; Secret into{" "}
                <code className="rounded bg-paper-2 px-1.5 py-0.5 text-sm">
                  .env.local
                </code>{" "}
                (see <code className="rounded bg-paper-2 px-1.5 py-0.5 text-sm">.env.example</code>)
              </li>
            </ol>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function PreviewRow({
  name,
  meta,
  tag,
  status,
}: {
  name: string;
  meta: string;
  tag: string;
  status: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3">
      <div>
        <p className="font-semibold text-ink">{name}</p>
        <p className="text-sm text-muted">{meta}</p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="rounded bg-paper-2 px-2 py-0.5 text-xs font-medium text-ink-soft">
          {tag}
        </span>
        <span className="text-xs text-accent">{status}</span>
      </div>
    </div>
  );
}

function LinkedInIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.23 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.46c.98 0 1.77-.77 1.77-1.73V1.73C24 .77 23.21 0 22.23 0z" />
    </svg>
  );
}
