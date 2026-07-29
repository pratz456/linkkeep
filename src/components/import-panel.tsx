"use client";

import { useState } from "react";

export function ImportPanel({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (summary: {
    imported: number;
    updated: number;
    totalParsed: number;
  }) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!file) {
      setError("Choose a CSV file first");
      return;
    }
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/connections/import", {
      method: "POST",
      body,
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Import failed");
      return;
    }
    await onImported(data);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 animate-fade">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl text-ink">Import connections</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              On LinkedIn: Me → Settings &amp; Privacy → Data privacy → Get a
              copy of your data → select <strong>Connections</strong> only.
              Upload the resulting <code>Connections.csv</code>.
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

        <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-line bg-paper px-4 py-10 text-center transition hover:border-accent">
          <span className="text-sm font-semibold text-ink">
            {file ? file.name : "Choose Connections.csv"}
          </span>
          <span className="mt-1 text-xs text-muted">CSV from LinkedIn export</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>

        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink-soft"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
          >
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
