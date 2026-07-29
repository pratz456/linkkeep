import { redirect } from "next/navigation";
import { auth, linkedInConfigured } from "@/auth";
import { signOutAction } from "@/app/actions";
import { ConnectionsWorkspace } from "@/components/connections-workspace";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line/80 bg-white/70 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-lg font-semibold tracking-tight text-ink">
              Link<span className="text-accent">Keep</span>
            </p>
            <p className="text-sm text-muted">
              Signed in as {session.user.name ?? session.user.email}
              {!linkedInConfigured ? " · demo mode" : ""}
            </p>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-accent"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <ConnectionsWorkspace
        userName={session.user.name ?? "there"}
        linkedInConfigured={linkedInConfigured}
      />
    </div>
  );
}
