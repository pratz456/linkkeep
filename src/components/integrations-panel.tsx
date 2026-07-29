"use client";

import { useEffect, useState } from "react";

type Webhooks = {
  duxsoup: string;
  phantombuster: string;
};

export function IntegrationsPanel({
  onClose,
}: {
  onClose: () => void;
}) {
  const [webhooks, setWebhooks] = useState<Webhooks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/integrations");
    if (!res.ok) {
      setError("Could not load webhook URLs");
      return;
    }
    const data = await res.json();
    setWebhooks(data.webhooks);
  }

  useEffect(() => {
    void load();
  }, []);

  async function rotate() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rotate" }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("Could not rotate token");
      return;
    }
    const data = await res.json();
    setWebhooks(data.webhooks);
  }

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 animate-fade">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl text-ink">Auto-sync integrations</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              LinkedIn won&apos;t give apps your connection list. Point
              PhantomBuster or Dux-Soup at these webhooks so their exports land
              in LinkKeep automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-medium text-muted hover:text-ink"
          >
            Close
          </button>
        </div>

        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

        <section className="mt-6 space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
            PhantomBuster
          </h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
            <li>
              Create/use the{" "}
              <a
                className="text-accent underline-offset-2 hover:underline"
                href="https://phantombuster.com/automations/linkedin/12670/linkedin-connections-export"
                target="_blank"
                rel="noreferrer"
              >
                LinkedIn Connections Export
              </a>{" "}
              Phantom
            </li>
            <li>Advanced settings → Webhooks → paste the URL below</li>
            <li>Schedule it daily or weekly for ongoing updates</li>
          </ol>
          <WebhookRow
            label="PhantomBuster URL"
            value={webhooks?.phantombuster}
            copied={copied === "pb"}
            onCopy={() =>
              webhooks && void copy("pb", webhooks.phantombuster)
            }
          />
        </section>

        <section className="mt-8 space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Dux-Soup
          </h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
            <li>Needs Dux-Soup Turbo or Cloud</li>
            <li>Options → Connect → enable Webhooks</li>
            <li>Paste the URL below; enable Visit + Scan events</li>
            <li>
              Browse or scan your connections in LinkedIn — profiles stream into
              LinkKeep as 1st-degree visits/scans arrive
            </li>
          </ol>
          <WebhookRow
            label="Dux-Soup URL"
            value={webhooks?.duxsoup}
            copied={copied === "dux"}
            onCopy={() => webhooks && void copy("dux", webhooks.duxsoup)}
          />
        </section>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-xs text-muted">
            Treat these URLs like passwords. Rotate if shared accidentally.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void rotate()}
            className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink-soft hover:border-accent hover:text-accent disabled:opacity-60"
          >
            {busy ? "Rotating…" : "Rotate webhook key"}
          </button>
        </div>
      </div>
    </div>
  );
}

function WebhookRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value?: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-paper px-3 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="block flex-1 break-all text-xs text-ink-soft">
          {value ?? "Loading…"}
        </code>
        <button
          type="button"
          disabled={!value}
          onClick={onCopy}
          className="shrink-0 rounded-md bg-ink px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
