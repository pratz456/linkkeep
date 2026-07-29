"use client";

import { useState } from "react";
import type { ConnectionStatus, ConnectionView } from "@/components/types";

export function ConnectionDetail({
  connection,
  onSaved,
  onDeleted,
}: {
  connection: ConnectionView;
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    firstName: connection.firstName,
    lastName: connection.lastName,
    email: connection.email ?? "",
    company: connection.company ?? "",
    position: connection.position ?? "",
    profileUrl: connection.profileUrl ?? "",
    connectedOn: connection.connectedOn ?? "",
    lastContactedAt: connection.lastContactedAt ?? "",
    notes: connection.notes,
    status: connection.status,
    tagsText: connection.tags.join(", "),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const tags = form.tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const res = await fetch(`/api/connections/${connection.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email || null,
        company: form.company || null,
        position: form.position || null,
        profileUrl: form.profileUrl || null,
        connectedOn: form.connectedOn || null,
        lastContactedAt: form.lastContactedAt || null,
        notes: form.notes,
        status: form.status,
        tags,
      }),
    });

    setSaving(false);
    if (!res.ok) {
      setError("Could not save changes");
      return;
    }
    await onSaved();
  }

  async function remove() {
    if (!confirm(`Remove ${connection.fullName}?`)) return;
    const res = await fetch(`/api/connections/${connection.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setError("Could not delete");
      return;
    }
    await onDeleted();
  }

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="rounded-2xl border border-line bg-white/80 p-6 shadow-[0_20px_50px_-40px_rgba(11,31,51,0.5)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl text-ink">
            {form.firstName} {form.lastName}
          </h2>
          <p className="mt-1 text-sm text-muted">
            Source: {connection.source}
            {connection.connectedOn ? ` · Connected ${connection.connectedOn}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {form.profileUrl ? (
            <a
              href={form.profileUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-line px-3 py-2 text-sm font-medium text-accent hover:border-accent"
            >
              Open profile
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => void remove()}
            className="rounded-md border border-danger/20 px-3 py-2 text-sm font-medium text-danger hover:bg-danger/5"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field label="First name">
          <input
            value={form.firstName}
            onChange={(e) => set("firstName", e.target.value)}
            className="w-full rounded-md border border-line bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30"
          />
        </Field>
        <Field label="Last name">
          <input
            value={form.lastName}
            onChange={(e) => set("lastName", e.target.value)}
            className="w-full rounded-md border border-line bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30"
          />
        </Field>
        <Field label="Email">
          <input
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            className="w-full rounded-md border border-line bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30"
          />
        </Field>
        <Field label="Company">
          <input
            value={form.company}
            onChange={(e) => set("company", e.target.value)}
            className="w-full rounded-md border border-line bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30"
          />
        </Field>
        <Field label="Position">
          <input
            value={form.position}
            onChange={(e) => set("position", e.target.value)}
            className="w-full rounded-md border border-line bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30"
          />
        </Field>
        <Field label="Status">
          <select
            value={form.status}
            onChange={(e) => set("status", e.target.value as ConnectionStatus)}
            className="w-full rounded-md border border-line bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30"
          >
            <option value="active">Active</option>
            <option value="warm">Warm</option>
            <option value="cold">Cold</option>
            <option value="archived">Archived</option>
          </select>
        </Field>
        <Field label="Profile URL">
          <input
            value={form.profileUrl}
            onChange={(e) => set("profileUrl", e.target.value)}
            className="w-full rounded-md border border-line bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30"
          />
        </Field>
        <Field label="Last contacted">
          <input
            type="date"
            value={form.lastContactedAt}
            onChange={(e) => set("lastContactedAt", e.target.value)}
            className="w-full rounded-md border border-line bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30"
          />
        </Field>
        <Field label="Tags (comma separated)" className="sm:col-span-2">
          <input
            value={form.tagsText}
            onChange={(e) => set("tagsText", e.target.value)}
            placeholder="investor, hiring, follow-up"
            className="w-full rounded-md border border-line bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30"
          />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={6}
            className="w-full resize-y rounded-md border border-line bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30"
            placeholder="Context, last conversation, next step…"
          />
        </Field>
      </div>

      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-md bg-ink px-5 py-2.5 text-sm font-semibold text-white hover:bg-ink-soft disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
