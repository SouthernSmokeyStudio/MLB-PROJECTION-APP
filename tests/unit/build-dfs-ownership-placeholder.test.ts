import { describe, expect, it } from "vitest";
import { buildDfsOwnershipPlaceholder } from "../../lib/services/buildDfsOwnershipPlaceholder";

describe("buildDfsOwnershipPlaceholder", () => {
  it("returns explicit placeholder ownership for ready DFS rows", () => {
    const result = buildDfsOwnershipPlaceholder({
      position: "RF",
      batting_order: 1,
      projected_points: 12.7,
      salary: 5600,
      is_blocked: false
    });

    expect(result.ownership_source).toBe("placeholder");
    expect(result.projected_ownership).not.toBeNull();
    expect(result.projected_ownership).toBeGreaterThanOrEqual(0);
    expect(result.projected_ownership).toBeLessThanOrEqual(1);
  });

  it("returns explicit placeholder source with null ownership for blocked DFS rows", () => {
    const result = buildDfsOwnershipPlaceholder({
      position: "P",
      batting_order: null,
      projected_points: 22.4,
      salary: 10200,
      is_blocked: true
    });

    expect(result).toEqual({
      projected_ownership: null,
      ownership_source: "placeholder"
    });
  });
});
