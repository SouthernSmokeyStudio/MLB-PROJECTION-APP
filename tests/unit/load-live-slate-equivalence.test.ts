/**
 * load-live-slate-equivalence.test.ts
 *
 * Behavioral proof that loadLiveSlate(date) and
 * loadLiveSlate(date, { materializedBaseline: undefined })
 * produce identical output on the no-artifact path.
 *
 * Also proves that loadLiveSlate itself rejects stale baselines
 * at its own boundary — independent of the route guard.
 */

import { describe, expect, it, vi } from "vitest";
import { asISOTimestamp } from "../../lib/contracts/types";
import type { MaterializedSlate } from "../../lib/contracts/materialized-slate";

// Mock the entire adapter layer so loadLiveSlate can run without network.
vi.mock("@lib/adapters/mlbStatsApi", async () => {
  const actual = await vi.importActual<typeof import("@lib/adapters/mlbStatsApi")>(
    "@lib/adapters/mlbStatsApi"
  );
  return {
    ...actual,
    fetchAndParseMlbStatsApiSchedule: vi.fn()
  };
});

import { loadLiveSlate } from "../../lib/services/loadLiveSlate";
import { fetchAndParseMlbStatsApiSchedule } from "../../lib/adapters/mlbStatsApi";

// ---------------------------------------------------------------------------
// 1. Behavioral equivalence: no-arg vs explicit undefined baseline
// ---------------------------------------------------------------------------

describe("loadLiveSlate — no-artifact behavioral equivalence", () => {
  it("loadLiveSlate(date) === loadLiveSlate(date, { materializedBaseline: undefined }) on empty schedule", async () => {
    // Both calls see the same mocked upstream: zero games returned.
    vi.mocked(fetchAndParseMlbStatsApiSchedule).mockResolvedValue({
      success: true,
      data: { rawGames: [], parsedGames: [] }
    } as never);

    const resultA = await loadLiveSlate("2026-04-10");
    const resultB = await loadLiveSlate("2026-04-10", { materializedBaseline: undefined });

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);

    if (!resultA.success || !resultB.success) {
      throw new Error("Both calls should succeed");
    }

    // Structural equivalence — everything except generated_at (timestamp)
    expect(resultA.data.source).toBe(resultB.data.source);
    expect(resultA.data.date).toBe(resultB.data.date);
    expect(resultA.data.counts).toEqual(resultB.data.counts);
    expect(resultA.data.note).toBe(resultB.data.note);
    expect(resultA.data.games).toEqual(resultB.data.games);
    expect(resultA.data.games).toHaveLength(0);
  });

  it("loadLiveSlate(date) === loadLiveSlate(date, { materializedBaseline: undefined }) on fetch failure", async () => {
    vi.mocked(fetchAndParseMlbStatsApiSchedule).mockResolvedValue({
      success: false,
      error: "Network error"
    } as never);

    const resultA = await loadLiveSlate("2026-04-10");
    const resultB = await loadLiveSlate("2026-04-10", { materializedBaseline: undefined });

    expect(resultA.success).toBe(false);
    expect(resultB.success).toBe(false);

    if (resultA.success || resultB.success) {
      throw new Error("Both calls should fail");
    }

    expect(resultA.error).toBe(resultB.error);
  });
});

// ---------------------------------------------------------------------------
// 2. loadLiveSlate rejects stale baseline at its own boundary
// ---------------------------------------------------------------------------

describe("loadLiveSlate — stale baseline rejection at load boundary", () => {
  it("stale baseline is ignored — equivalent to no baseline", async () => {
    vi.mocked(fetchAndParseMlbStatsApiSchedule).mockResolvedValue({
      success: true,
      data: { rawGames: [], parsedGames: [] }
    } as never);

    const staleBaseline: MaterializedSlate = {
      version: 1,
      date: "2026-04-10",
      // 30 days ago — well beyond the 24h threshold
      generated_at: asISOTimestamp(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      ),
      source: "stale-test",
      games: [
        {
          game_id: "mlb-2026-04-10-fake" as never,
          prepared: { game_id: "mlb-2026-04-10-fake" } as never
        }
      ]
    };

    const withStale = await loadLiveSlate("2026-04-10", {
      materializedBaseline: staleBaseline
    });
    const withoutBaseline = await loadLiveSlate("2026-04-10");

    expect(withStale.success).toBe(true);
    expect(withoutBaseline.success).toBe(true);

    if (!withStale.success || !withoutBaseline.success) {
      throw new Error("Both calls should succeed");
    }

    // Stale baseline was silently rejected — output is equivalent
    expect(withStale.data.games).toEqual(withoutBaseline.data.games);
    expect(withStale.data.counts).toEqual(withoutBaseline.data.counts);
    expect(withStale.data.note).toBe(withoutBaseline.data.note);
  });
});
