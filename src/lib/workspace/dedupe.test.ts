import { describe, expect, it } from "vitest";
import {
  artifactDedupeKey,
  scoreDuplicatePair,
  type DedupeCandidate,
} from "@/lib/workspace/dedupe";

const base: DedupeCandidate = {
  id: "gmail-item",
  title: "Review Northstar renewal proposal",
  project: "Northstar",
  actors: ["customer@example.com"],
  dueAt: "2026-09-25T17:00:00.000Z",
  sourceReferences: ["northstar-renewal"],
  recurrenceKey: null,
  isManual: false,
  structuredExternalId: null,
  explicitOwner: "me@example.com",
};

describe("deduplication", () => {
  it("auto-merges strongly corroborated cross-source candidates", () => {
    const result = scoreDuplicatePair(base, {
      ...base,
      id: "meeting-item",
    });

    expect(result.score).toBe(1);
    expect(result.decision).toBe("auto_merged");
    expect(result.hardConflicts).toEqual([]);
  });

  it("keeps distinct action verbs and recurring occurrences separate", () => {
    const result = scoreDuplicatePair(
      { ...base, recurrenceKey: "2026-09-25T09:00" },
      {
        ...base,
        id: "approve-item",
        title: "Approve Northstar renewal proposal",
        recurrenceKey: "2026-10-25T09:00",
      },
    );

    expect(result.decision).toBe("review_distinct");
    expect(result.hardConflicts).toContain("different_recurrence_occurrences");
    expect(result.hardConflicts).toContain("distinct_action_verbs");
  });

  it("creates stable provider idempotency keys", () => {
    const input = {
      connectorAccountId: "account-1",
      kind: "email_thread",
      externalId: "thread-123",
    };

    expect(artifactDedupeKey(input)).toBe(
      "account-1:email_thread:thread-123",
    );
    expect(artifactDedupeKey(input)).toBe(artifactDedupeKey(input));
  });
});
