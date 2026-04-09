import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildPreparedStarterFromPeopleStats } from "@lib/adapters/mlbStatsApi";
import { asPlayerId, asTeamId } from "@lib/contracts/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PLAYER_ID = asPlayerId("gerrit-cole");
const TEAM_ID = asTeamId("nyy");

const buildValidPeopleStatsPayload = (overrides: Record<string, unknown> = {}) => ({
  stats: [
    {
      splits: [
        {
          stat: {
            era: "3.12",
            whip: "1.06",
            strikeoutsPer9Inn: "10.20",
            walksPer9Inn: "2.40",
            homeRunsPer9: "1.10",
            inningsPitched: "120.1",
            gamesStarted: 20,
            ...overrides
          }
        }
      ]
    }
  ]
});

// ---------------------------------------------------------------------------
// buildPreparedStarterFromPeopleStats
// ---------------------------------------------------------------------------

describe("buildPreparedStarterFromPeopleStats", () => {
  it("parses all numeric stats from a valid payload", () => {
    const result = buildPreparedStarterFromPeopleStats(
      PLAYER_ID,
      TEAM_ID,
      buildValidPeopleStatsPayload()
    );

    expect(result).not.toBeNull();
    expect(result?.player_id).toBe(PLAYER_ID);
    expect(result?.team_id).toBe(TEAM_ID);
    expect(result?.season_era).toBeCloseTo(3.12);
    expect(result?.season_whip).toBeCloseTo(1.06);
    expect(result?.season_k_per_9).toBeCloseTo(10.2);
    expect(result?.season_bb_per_9).toBeCloseTo(2.4);
    expect(result?.season_hr_per_9).toBeCloseTo(1.1);
    expect(result?.handedness).toBe("unknown");
  });

  it("computes recent_ip_per_start from season totals", () => {
    // 120.1 IP = 120 + 1/3 = 120.333... over 20 starts → ~6.017 IP/start
    const result = buildPreparedStarterFromPeopleStats(
      PLAYER_ID,
      TEAM_ID,
      buildValidPeopleStatsPayload()
    );

    expect(result?.recent_ip_per_start).not.toBeNull();
    expect(result?.recent_ip_per_start).toBeGreaterThan(5);
    expect(result?.recent_ip_per_start).toBeLessThan(8);
  });

  it("returns null when payload is not an object", () => {
    expect(buildPreparedStarterFromPeopleStats(PLAYER_ID, TEAM_ID, null)).toBeNull();
    expect(buildPreparedStarterFromPeopleStats(PLAYER_ID, TEAM_ID, 42)).toBeNull();
    expect(buildPreparedStarterFromPeopleStats(PLAYER_ID, TEAM_ID, "bad")).toBeNull();
  });

  it("returns null when stats array is absent", () => {
    const result = buildPreparedStarterFromPeopleStats(PLAYER_ID, TEAM_ID, { stats: null });
    expect(result).toBeNull();
  });

  it("returns null when splits array is absent", () => {
    const payload = { stats: [{ splits: null }] };
    const result = buildPreparedStarterFromPeopleStats(PLAYER_ID, TEAM_ID, payload);
    expect(result).toBeNull();
  });

  it("returns null when stat block is absent inside the split", () => {
    const payload = { stats: [{ splits: [{ stat: null }] }] };
    const result = buildPreparedStarterFromPeopleStats(PLAYER_ID, TEAM_ID, payload);
    expect(result).toBeNull();
  });

  it("returns null stat fields gracefully when stat strings are missing", () => {
    const result = buildPreparedStarterFromPeopleStats(
      PLAYER_ID,
      TEAM_ID,
      buildValidPeopleStatsPayload({
        era: undefined,
        whip: undefined,
        strikeoutsPer9Inn: undefined,
        walksPer9Inn: undefined
      })
    );

    // season_ip and gamesStarted are still present, so recent_ip_per_start is computable
    expect(result).not.toBeNull();
    expect(result?.season_era).toBeNull();
    expect(result?.season_whip).toBeNull();
    expect(result?.season_k_per_9).toBeNull();
    expect(result?.season_bb_per_9).toBeNull();
  });

  it("sets recent_ip_per_start to null when gamesStarted is 0", () => {
    const result = buildPreparedStarterFromPeopleStats(
      PLAYER_ID,
      TEAM_ID,
      buildValidPeopleStatsPayload({ gamesStarted: 0 })
    );

    expect(result?.recent_ip_per_start).toBeNull();
  });

  it("sets all recent/rest fields to null (pre-game knowledge boundary)", () => {
    const result = buildPreparedStarterFromPeopleStats(
      PLAYER_ID,
      TEAM_ID,
      buildValidPeopleStatsPayload()
    );

    expect(result?.recent_starts_n).toBeNull();
    expect(result?.recent_era).toBeNull();
    expect(result?.recent_k_per_9).toBeNull();
    expect(result?.days_rest).toBeNull();
    expect(result?.last_start_pitches).toBeNull();
    expect(result?.vs_lhb_era).toBeNull();
    expect(result?.vs_rhb_era).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fetchMlbStatsApiPitcherSeasonStats — fetch boundary tests
// ---------------------------------------------------------------------------

describe("fetchMlbStatsApiPitcherSeasonStats", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok result when API returns a valid payload with stat block", async () => {
    const { fetchMlbStatsApiPitcherSeasonStats } = await import("@lib/adapters/mlbStatsApi");

    const mockPayload = buildValidPeopleStatsPayload();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockPayload
      })
    );

    const result = await fetchMlbStatsApiPitcherSeasonStats(543037, "2025");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(mockPayload);
    }
  });

  it("returns err when the HTTP status is not ok", async () => {
    const { fetchMlbStatsApiPitcherSeasonStats } = await import("@lib/adapters/mlbStatsApi");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ ok: false, status: 404 })
    );

    const result = await fetchMlbStatsApiPitcherSeasonStats(543037, "2025");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("404");
    }
  });

  it("returns err when the response is not valid JSON", async () => {
    const { fetchMlbStatsApiPitcherSeasonStats } = await import("@lib/adapters/mlbStatsApi");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        }
      })
    );

    const result = await fetchMlbStatsApiPitcherSeasonStats(543037, "2025");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("not valid JSON");
    }
  });

  it("returns err when stat block is absent in the response", async () => {
    const { fetchMlbStatsApiPitcherSeasonStats } = await import("@lib/adapters/mlbStatsApi");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ stats: [] })
      })
    );

    const result = await fetchMlbStatsApiPitcherSeasonStats(543037, "2025");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("missing stat block");
    }
  });

  it("returns err when payload is not an object", async () => {
    const { fetchMlbStatsApiPitcherSeasonStats } = await import("@lib/adapters/mlbStatsApi");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => [1, 2, 3]
      })
    );

    const result = await fetchMlbStatsApiPitcherSeasonStats(543037, "2025");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("must be an object");
    }
  });
});
