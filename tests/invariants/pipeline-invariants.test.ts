import { describe, expect, it } from "vitest";
import prepared from "../../data/fixtures/sample-prepared-game.json";
import invalidPrepared from "../../data/fixtures/sample-prepared-game-invalid.json";
import { runAllPreparedGameChecks, shouldBlockGame } from "@lib/checks";

describe("pipeline invariants", () => {
  it("is deterministic for identical inputs", () => {
    const a = runAllPreparedGameChecks(prepared, undefined, new Date("2026-03-27T15:15:00Z"));
    const b = runAllPreparedGameChecks(prepared, undefined, new Date("2026-03-27T15:15:00Z"));
    expect(a.errors).toBe(b.errors);
    expect(a.warnings).toBe(b.warnings);
  });

  it("fails closed on invalid inputs", () => {
    const summary = runAllPreparedGameChecks(invalidPrepared, undefined, new Date("2026-03-27T15:15:00Z"));
    expect(shouldBlockGame(invalidPrepared, summary).blocked).toBe(true);
  });

  it("does not block a valid prepared fixture", () => {
    const summary = runAllPreparedGameChecks(prepared, undefined, new Date("2026-03-27T15:15:00Z"));
    expect(shouldBlockGame(prepared, summary).blocked).toBe(false);
  });
});
