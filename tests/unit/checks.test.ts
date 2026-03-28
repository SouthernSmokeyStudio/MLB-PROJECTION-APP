import { describe, expect, it } from "vitest";
import normalizedFixture from "../../data/fixtures/sample-normalized-game.json";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import invalidPreparedFixture from "../../data/fixtures/sample-prepared-game-invalid.json";
import type { CanonicalGame } from "@lib/contracts/canonical";
import type { PreparedGameInputs } from "@lib/contracts/prepared";
import { runAllCanonicalGameChecks, runAllPreparedGameChecks, shouldBlockGame } from "@lib/checks";

const normalized = normalizedFixture as unknown as CanonicalGame;
const prepared = preparedFixture as unknown as PreparedGameInputs;
const invalidPrepared = invalidPreparedFixture as unknown as PreparedGameInputs;

describe("checks", () => {
  it("passes a valid canonical game", () => {
    const summary = runAllCanonicalGameChecks(normalized);
    expect(summary.errors).toBe(0);
  });

  it("passes a valid prepared game without blocking", () => {
    const summary = runAllPreparedGameChecks(prepared, undefined, new Date("2026-03-27T15:15:00Z"));
    expect(summary.errors).toBe(0);
    expect(shouldBlockGame(prepared, summary).blocked).toBe(false);
  });

  it("blocks an invalid prepared game", () => {
    const summary = runAllPreparedGameChecks(invalidPrepared, undefined, new Date("2026-03-27T15:15:00Z"));
    const decision = shouldBlockGame(invalidPrepared, summary);
    expect(summary.errors).toBeGreaterThan(0);
    expect(decision.blocked).toBe(true);
  });

  it("requires blocked_reason when blocked is true", () => {
    const summary = runAllPreparedGameChecks(invalidPrepared, undefined, new Date("2026-03-27T15:15:00Z"));
    expect(summary.results.some((result) => result.message.includes("blocked_reason"))).toBe(true);
  });

  it("catches out of range venue and weather values", () => {
    const summary = runAllPreparedGameChecks(invalidPrepared, undefined, new Date("2026-03-27T15:15:00Z"));
    const messages = summary.results.map((result) => result.message).join(" | ");
    expect(messages).toContain("park_factor_runs outside allowed range");
    expect(messages).toContain("temperature_f outside allowed range");
    expect(messages).toContain("wind_speed_mph outside allowed range");
  });
});
