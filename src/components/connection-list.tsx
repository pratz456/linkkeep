"use client";

import type { ConnectionView } from "@/components/types";

export function ConnectionList({
  connections,
  selectedId,
  onSelect,
}: {
  connections: ConnectionView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (!connections.length) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-white/70 px-4 py-8 text-center text-sm text-muted">
        No connections match these filters.
      </div>
    );
  }

  return (
    <ul className="max-h-[62vh] space-y-2 overflow-y-auto pr-1">
      {connections.map((c) => {
        const active = c.id === selectedId;
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                active
                  ? "border-accent bg-accent/5 shadow-sm"
                  : "border-line bg-white hover:border-accent/40"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink">{c.fullName}</p>
                  <p className="text-sm text-muted">
                    {[c.position, c.company].filter(Boolean).join(" · ") ||
                      "No title yet"}
                  </p>
                </div>
                <StatusDot status={c.status} />
              </div>
              {c.tags.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {c.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-paper-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-soft"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "active"
      ? "bg-success"
      : status === "warm"
        ? "bg-warm"
        : status === "cold"
          ? "bg-muted"
          : "bg-line";
  return (
    <span
      className={`mt-1 inline-block h-2 w-2 rounded-full ${color}`}
      title={status}
    />
  );
}
