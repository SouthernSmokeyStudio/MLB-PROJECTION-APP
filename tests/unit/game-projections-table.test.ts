/**
 * game-projections-table.test.ts
 *
 * Proves that upsertGameProjections returns a result type instead of swallowing
 * errors silently. Prior behavior: catch {} discarded all write failures.
 * Morning-capture always reported { ok: true } even when the upsert failed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpsertGameProjectionsResult } from "../../lib/supabase/gameProjectionsTable";

// ---------------------------------------------------------------------------
// Mock getSupabaseWriteClient
// ---------------------------------------------------------------------------

const mockUpsert = vi.fn();

vi.mock("../../lib/supabase/writeClient", () => ({
  getSupabaseWriteClient: () => ({
    from: () => ({ upsert: mockUpsert })
  })
}));

const { upsertGameProjections } = await import("../../lib/supabase/gameProjectionsTable");

// ---------------------------------------------------------------------------
// Minimal valid row
// ---------------------------------------------------------------------------

const makeRow = () => ({
  projection_date: "2026-04-21",
  game_id: "mlb-2026-04-21-nyy-bos",
  sport_id: "MLB",
  away_team_id: "nyy",
  home_team_id: "bos",
  run_id: null,
  scheduled_start: null,
  projected_away_runs: 4.5,
  projected_home_runs: 4.2,
  projected_total_runs: 8.7,
  projected_away_win_probability: null,
  projected_home_win_probability: null,
  is_blocked: false,
  blocked_reason: null,
  is_stale: false,
  source_run_key: null,
  source_generated_at: null
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("upsertGameProjections — result type surfaces write failures", () => {
  beforeEach(() => {
    mockUpsert.mockReset();
  });

  it("returns ok: true when upsert succeeds", async () => {
    mockUpsert.mockResolvedValue({ data: null, error: null });

    const result: UpsertGameProjectionsResult = await upsertGameProjections([makeRow()]);

    expect(result.ok).toBe(true);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it("returns ok: true immediately when no rows are provided (skip write)", async () => {
    const result: UpsertGameProjectionsResult = await upsertGameProjections([]);

    expect(result.ok).toBe(true);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns ok: false with error when Supabase upsert returns an error", async () => {
    mockUpsert.mockResolvedValue({
      data: null,
      error: { message: "duplicate key value violates unique constraint", code: "23505", hint: null }
    });

    const result: UpsertGameProjectionsResult = await upsertGameProjections([makeRow()]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain("duplicate key value");
  });

  it("returns ok: false with error when getSupabaseWriteClient throws (env missing)", async () => {
    // Simulate env missing — writeClient throws before upsert is called.
    mockUpsert.mockImplementationOnce(() => {
      throw new Error("Supabase write client requires NEXT_PUBLIC_SUPABASE_URL.");
    });

    const result: UpsertGameProjectionsResult = await upsertGameProjections([makeRow()]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain("NEXT_PUBLIC_SUPABASE_URL");
  });
});
