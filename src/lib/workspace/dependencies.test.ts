import { describe, expect, it } from "vitest";
import { validateDependency } from "@/lib/workspace/dependencies";

describe("dependency validation", () => {
  it("rejects self-links and blocking cycles", () => {
    expect(
      validateDependency([], {
        predecessorId: "a",
        successorId: "a",
        type: "blocks",
      }),
    ).toEqual({ valid: false, reason: "self_dependency" });

    expect(
      validateDependency(
        [
          { predecessorId: "a", successorId: "b", type: "blocks" },
          { predecessorId: "b", successorId: "c", type: "waiting_on" },
        ],
        { predecessorId: "c", successorId: "a", type: "blocks" },
      ),
    ).toEqual({ valid: false, reason: "dependency_cycle" });
  });

  it("allows non-directional related links", () => {
    expect(
      validateDependency([], {
        predecessorId: "a",
        successorId: "b",
        type: "related",
      }),
    ).toEqual({ valid: true, reason: null });
  });
});
