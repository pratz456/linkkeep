import { describe, expect, it } from "vitest";
import { createDemoWorkspace } from "@/lib/workspace/demo-data";

describe("demo workspace time zone", () => {
  it("generates fixed UTC schedule times for hydration-safe rendering", () => {
    const snapshot = createDemoWorkspace(
      new Date("2026-09-24T18:25:00.000Z"),
    );
    const standup = snapshot.schedule.find(
      (item) => item.id === "schedule-standup",
    );

    expect(snapshot.timeZone).toBe("UTC");
    expect(standup?.startAt).toBe("2026-09-24T09:30:00.000Z");
    expect(standup?.endAt).toBe("2026-09-24T09:55:00.000Z");
  });
});
