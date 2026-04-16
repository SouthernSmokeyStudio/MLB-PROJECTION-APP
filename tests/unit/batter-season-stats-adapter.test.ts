/**
 * Batter season-stats adapter boundary proof.
 *
 * Proves that buildPreparedBatterFromPeopleStats:
 *  - maps a valid MLB Stats API /people/{id}/stats?group=hitting payload
 *    onto the required PreparedBatterInputs fields
 *  - populates season_avg and season_pa (the two model-required non-optional inputs)
 *  - derives season_iso from avg and slg
 *  - computes rate fields (bb_rate, hr_rate, k_rate) via plate-appearance division
 *  - returns the skeleton batter unchanged when the payload is missing or malformed
 *  - preserves all identity and admission fields (player_id, team_id, batting_order,
 *    lineup_status) regardless of stat payload
 */

import { describe, expect, it } from "vitest";
import type { PreparedBatterInputs } from "../../lib/contracts/prepared";
import {
  asPlayerId,
  asTeamId
} from "../../lib/contracts/types";
import { buildPreparedBatterFromPeopleStats } from "../../lib/adapters/mlbStatsApi";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSkeleton = (): PreparedBatterInputs => ({
  player_id: asPlayerId("667891"),
  mlb_stats_api_id: null,
  team_id: asTeamId("bal"),
  batting_order: 3,
  handedness: "unknown",
  lineup_status: "confirmed_order",
  season_pa: null,
  season_avg: null,
  season_obp: null,
  season_slg: null,
  season_woba: null,
  season_iso: null,
  season_k_rate: null,
  season_bb_rate: null,
  season_hr_rate: null,
  season_sb: null,
  recent_games_n: null,
  recent_woba: null,
  recent_avg: null,
  vs_lhp_woba: null,
  vs_rhp_woba: null
});

/** Minimal valid payload shape returned by the MLB Stats API. */
const makeHittingPayload = (overrides: Record<string, unknown> = {}): unknown => ({
  stats: [
    {
      splits: [
        {
          stat: {
            plateAppearances: 550,
            avg: "0.281",
            obp: "0.358",
            slg: "0.472",
            strikeOuts: 112,
            baseOnBalls: 58,
            homeRuns: 22,
            stolenBases: 8,
            ...overrides
          }
        }
      ]
    }
  ]
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildPreparedBatterFromPeopleStats — adapter boundary", () => {
  it("populates season_avg and season_pa from a valid payload", () => {
    const result = buildPreparedBatterFromPeopleStats(makeSkeleton(), makeHittingPayload());

    expect(result.season_avg).toBeCloseTo(0.281);
    expect(result.season_pa).toBe(550);
  });

  it("populates season_obp, season_slg, and derives season_iso", () => {
    const result = buildPreparedBatterFromPeopleStats(makeSkeleton(), makeHittingPayload());

    expect(result.season_obp).toBeCloseTo(0.358);
    expect(result.season_slg).toBeCloseTo(0.472);
    // iso = slg - avg = 0.472 - 0.281 = 0.191
    expect(result.season_iso).toBeCloseTo(0.191, 3);
  });

  it("computes rate fields via plate-appearance division", () => {
    const result = buildPreparedBatterFromPeopleStats(makeSkeleton(), makeHittingPayload());

    // bb_rate = 58 / 550
    expect(result.season_bb_rate).toBeCloseTo(58 / 550, 5);
    // hr_rate = 22 / 550
    expect(result.season_hr_rate).toBeCloseTo(22 / 550, 5);
    // k_rate = 112 / 550
    expect(result.season_k_rate).toBeCloseTo(112 / 550, 5);
    expect(result.season_sb).toBe(8);
  });

  it("preserves all identity and admission fields", () => {
    const skeleton = makeSkeleton();
    const result = buildPreparedBatterFromPeopleStats(skeleton, makeHittingPayload());

    expect(result.player_id).toBe(skeleton.player_id);
    expect(result.team_id).toBe(skeleton.team_id);
    expect(result.batting_order).toBe(skeleton.batting_order);
    expect(result.lineup_status).toBe("confirmed_order");
    expect(result.handedness).toBe("unknown");
  });

  it("returns skeleton unchanged when payload is null", () => {
    const skeleton = makeSkeleton();
    const result = buildPreparedBatterFromPeopleStats(skeleton, null);

    expect(result).toBe(skeleton);
    expect(result.season_avg).toBeNull();
    expect(result.season_pa).toBeNull();
  });

  it("returns skeleton unchanged when payload is not an object", () => {
    const skeleton = makeSkeleton();
    expect(buildPreparedBatterFromPeopleStats(skeleton, "bad")).toBe(skeleton);
    expect(buildPreparedBatterFromPeopleStats(skeleton, 42)).toBe(skeleton);
    expect(buildPreparedBatterFromPeopleStats(skeleton, [])).toBe(skeleton);
  });

  it("returns skeleton unchanged when stats array is missing", () => {
    const skeleton = makeSkeleton();
    const result = buildPreparedBatterFromPeopleStats(skeleton, { no_stats_key: true });
    expect(result).toBe(skeleton);
  });

  it("returns skeleton unchanged when splits are empty", () => {
    const skeleton = makeSkeleton();
    const payload = { stats: [{ splits: [] }] };
    const result = buildPreparedBatterFromPeopleStats(skeleton, payload);
    expect(result).toBe(skeleton);
  });

  it("sets season_iso to null when avg or slg is missing from payload", () => {
    const result = buildPreparedBatterFromPeopleStats(
      makeSkeleton(),
      makeHittingPayload({ avg: undefined, slg: undefined })
    );

    expect(result.season_iso).toBeNull();
    // Other fields still parsed where present
    expect(result.season_obp).toBeCloseTo(0.358);
  });

  it("sets rate fields to null when plate appearances is zero", () => {
    const result = buildPreparedBatterFromPeopleStats(
      makeSkeleton(),
      makeHittingPayload({ plateAppearances: 0 })
    );

    expect(result.season_bb_rate).toBeNull();
    expect(result.season_hr_rate).toBeNull();
    expect(result.season_k_rate).toBeNull();
  });
});
