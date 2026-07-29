"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { ConnectionDetail } from "@/components/connection-detail";
import { ConnectionList } from "@/components/connection-list";
import { ImportPanel } from "@/components/import-panel";
import { IntegrationsPanel } from "@/components/integrations-panel";
import type { ConnectionView } from "@/components/types";

type Counts = Record<string, number>;

export function ConnectionsWorkspace({
  userName,
  linkedInConfigured,
}: {
  userName: string;
  linkedInConfigured: boolean;
}) {
  const [connections, setConnections] = useState<ConnectionView[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showImport, setShowImport] = useState(false);
  const [showIntegrations, setShowIntegrations] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (status !== "all") params.set("status", status);

    const res = await fetch(`/api/connections?${params.toString()}`);
    if (!res.ok) {
      setError("Failed to load connections");
      return;
    }
    const data = await res.json();
    setConnections(data.connections);
    setCounts(data.counts ?? {});
    setError(null);
    if (
      selectedId &&
      !data.connections.some((c: ConnectionView) => c.id === selectedId)
    ) {
      setSelectedId(data.connections[0]?.id ?? null);
    } else if (!selectedId && data.connections[0]) {
      setSelectedId(data.connections[0].id);
    }
  }, [query, status, selectedId]);

  useEffect(() => {
    startTransition(() => {
      void load();
    });
  }, [load]);

  const selected = useMemo(
    () => connections.find((c) => c.id === selectedId) ?? null,
    [connections, selectedId],
  );

  const totalAll = Object.values(counts).reduce((a, b) => a + Number(b), 0);

  async function handleSync() {
    setMessage(null);
    setError(null);
    const res = await fetch("/api/connections/sync", { method: "POST" });
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      setError(data.message ?? "Sync failed");
      return;
    }
    setMessage(
      `Synced from LinkedIn API: ${data.imported} new, ${data.updated} updated.`,
    );
    await load();
  }

  async function handleCreate() {
    const res = await fetch("/api/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "New",
        lastName: "Connection",
        notes: "",
        tags: [],
        status: "active",
      }),
    });
    if (!res.ok) {
      setError("Could not create connection");
      return;
    }
    const created = await res.json();
    await load();
    setSelectedId(created.id);
    setMessage("Added a blank connection — fill in the details.");
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      <div className="animate-rise flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl text-ink sm:text-4xl">
            Hi {userName.split(" ")[0]}, here&apos;s your network
          </h1>
          <p className="mt-2 text-ink-soft">
            {totalAll} connections tracked
            {isPending ? " · refreshing…" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowIntegrations(true)}
            className="rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-deep"
          >
            Auto-sync setup
          </button>
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="rounded-md border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink-soft hover:border-accent hover:text-accent"
          >
            Import CSV
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            className="rounded-md border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink-soft hover:border-accent hover:text-accent"
          >
            Add manually
          </button>
          {linkedInConfigured ? (
            <button
              type="button"
              onClick={() => void handleSync()}
              className="rounded-md border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink-soft hover:border-accent hover:text-accent"
              title="Requires LinkedIn partner API access"
            >
              Sync via API
            </button>
          ) : null}
        </div>
      </div>

      {message ? (
        <p className="animate-fade rounded-md border border-success/20 bg-success/5 px-4 py-3 text-sm text-success">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="animate-fade rounded-md border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="animate-rise grid gap-6 lg:grid-cols-[320px_1fr]" style={{ animationDelay: "0.08s" }}>
        <aside className="space-y-4">
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, company, notes…"
              className="w-full rounded-md border border-line bg-white px-3 py-2.5 text-sm outline-none ring-accent/30 focus:ring-2"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", "All"],
                ["active", "Active"],
                ["warm", "Warm"],
                ["cold", "Cold"],
                ["archived", "Archived"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  status === value
                    ? "bg-ink text-white"
                    : "bg-white text-muted border border-line hover:text-ink"
                }`}
              >
                {label}
                {value !== "all" && counts[value]
                  ? ` · ${counts[value]}`
                  : value === "all" && totalAll
                    ? ` · ${totalAll}`
                    : ""}
              </button>
            ))}
          </div>
          <ConnectionList
            connections={connections}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </aside>

        <section>
          {selected ? (
            <ConnectionDetail
              key={selected.id}
              connection={selected}
              onSaved={async () => {
                setMessage("Saved");
                await load();
              }}
              onDeleted={async () => {
                setSelectedId(null);
                setMessage("Connection removed");
                await load();
              }}
            />
          ) : (
            <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white/60 px-6 text-center">
              <p className="font-serif text-2xl text-ink">No connection selected</p>
              <p className="mt-2 max-w-sm text-sm text-muted">
                Connect PhantomBuster or Dux-Soup for auto-sync, import a CSV, or
                add someone manually.
              </p>
              <button
                type="button"
                onClick={() => setShowIntegrations(true)}
                className="mt-5 rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-deep"
              >
                Auto-sync setup
              </button>
            </div>
          )}
        </section>
      </div>

      {showImport ? (
        <ImportPanel
          onClose={() => setShowImport(false)}
          onImported={async (summary) => {
            setShowImport(false);
            setMessage(
              `Imported ${summary.imported} new · updated ${summary.updated} from CSV (${summary.totalParsed} rows).`,
            );
            await load();
          }}
        />
      ) : null}

      {showIntegrations ? (
        <IntegrationsPanel onClose={() => setShowIntegrations(false)} />
      ) : null}
    </main>
  );
}
