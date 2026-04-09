/**
 * Schema lock tests for latest_game_projection_truth.
 *
 * Proves that parseAssembledGameProjection / parseGameProjection:
 *  - accept valid assembled projections (round-trip from assembleGameProjection)
 *  - accept blocked projections without throwing (blocked is valid data)
 *  - throw on every required missing/invalid field
 *  - pass blocked_reason through correctly
 *
 * Source of truth: lib/contracts/projections.ts + assembleGameProjection.ts
 */

import { describe, expect, it } from "vitest";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import invalidPreparedFixture from "../../data/fixtures/sample-prepared-game-invalid.json";
import type { PreparedGameInputs } from "../../lib/contracts/prepared";
import { assembleGameProjection } from "../../lib/projections/assembleGameProjection";
import {
  parseAssembledGameProjection,
  parseGameProjection
} from "../../lib/game-projection";

const prepared = preparedFixture as unknown as PreparedGameInputs;
const invalidPrepared = invalidPreparedFixture as unknown as PreparedGameInputs;

// ---------------------------------------------------------------------------
// Round-trip: valid prepared inputs
// ---------------------------------------------------------------------------

describe("parseAssembledGameProjection — round-trip", () => {
  it("accepts the full assembled output for a valid prepared game", () => {
    const assembled = assembleGameProjection(prepared);
    const parsed = parseAssembledGameProjection(assembled);

    expect(parsed.game_projection.game_id).toBe(assembled.game_projection.game_id);
    expect(parsed.game_projection.sport_id).toBe("MLB");
    expect(parsed.game_projection.metadata.blocked.is_blocked).toBe(false);
    expect(parsed.game_projection.projected_total).toBeGreaterThan(0);
    expect(parsed.game_projection.away.projected_runs).toBeGreaterThan(0);
    expect(parsed.game_projection.home.projected_runs).toBeGreaterThan(0);
    expect(parsed.away_pitcher).not.toBeNull();
    expect(parsed.home_pitcher).not.toBeNull();
    expect(parsed.away_batters).toHaveLength(9);
    expect(parsed.home_batters).toHaveLength(9);
  });

  it("accepts a blocked assembled output — blocked is valid data, not an error", () => {
    const assembled = assembleGameProjection(invalidPrepared);

    // Verify the source is actually blocked
    expect(assembled.game_projection.metadata.blocked.is_blocked).toBe(true);

    // Validator must not throw on blocked projections
    const parsed = parseAssembledGameProjection(assembled);

    expect(parsed.game_projection.metadata.blocked.is_blocked).toBe(true);
    expect(parsed.game_projection.metadata.blocked.blocked_reason).toBeTruthy();
    // projected_total defaults to 0 when blocked, not null
    expect(parsed.game_projection.projected_total).toBe(0);
    expect(parsed.game_projection.away.projected_runs).toBe(0);
    expect(parsed.game_projection.home.projected_runs).toBe(0);
  });

  it("preserves projected_total == away + home for unblocked games", () => {
    const assembled = assembleGameProjection(prepared);
    const parsed = parseAssembledGameProjection(assembled);

    expect(parsed.game_projection.projected_total).toBeCloseTo(
      parsed.game_projection.away.projected_runs +
        parsed.game_projection.home.projected_runs
    );
  });
});

// ---------------------------------------------------------------------------
// parseGameProjection — fail-closed: required field violations
// ---------------------------------------------------------------------------

describe("parseGameProjection — fail-closed", () => {
  const validGameProjection = () =>
    assembleGameProjection(prepared).game_projection;

  it("throws when the input is not an object", () => {
    expect(() => parseGameProjection(null)).toThrow("must be an object");
    expect(() => parseGameProjection("string")).toThrow("must be an object");
    expect(() => parseGameProjection(42)).toThrow("must be an object");
  });

  it("throws when game_id is missing or empty", () => {
    const base = { ...validGameProjection() };
    expect(() =>
      parseGameProjection({ ...base, game_id: "" })
    ).toThrow("game_id");
    expect(() =>
      parseGameProjection({ ...base, game_id: null })
    ).toThrow("game_id");
  });

  it("throws when sport_id is not MLB", () => {
    const base = validGameProjection();
    expect(() =>
      parseGameProjection({ ...base, sport_id: "NFL" })
    ).toThrow('sport_id must be "MLB"');
    expect(() =>
      parseGameProjection({ ...base, sport_id: null })
    ).toThrow('sport_id must be "MLB"');
  });

  it("throws when metadata is absent", () => {
    const base = validGameProjection();
    expect(() =>
      parseGameProjection({ ...base, metadata: null })
    ).toThrow("metadata");
  });

  it("throws when metadata.blocked is absent", () => {
    const base = validGameProjection();
    expect(() =>
      parseGameProjection({
        ...base,
        metadata: { ...base.metadata, blocked: null }
      })
    ).toThrow("metadata.blocked");
  });

  it("throws when metadata.blocked.is_blocked is not a boolean", () => {
    const base = validGameProjection();
    expect(() =>
      parseGameProjection({
        ...base,
        metadata: {
          ...base.metadata,
          blocked: { is_blocked: "yes", blocked_reason: null }
        }
      })
    ).toThrow("is_blocked");
  });

  it("throws when projected_total is missing", () => {
    const base = validGameProjection();
    expect(() =>
      parseGameProjection({ ...base, projected_total: undefined })
    ).toThrow("projected_total");
  });

  it("throws when projected_total is non-finite", () => {
    const base = validGameProjection();
    expect(() =>
      parseGameProjection({ ...base, projected_total: NaN })
    ).toThrow("projected_total");
    expect(() =>
      parseGameProjection({ ...base, projected_total: Infinity })
    ).toThrow("projected_total");
  });

  it("throws when away.projected_runs is non-finite", () => {
    const base = validGameProjection();
    expect(() =>
      parseGameProjection({
        ...base,
        away: { ...base.away, projected_runs: NaN }
      })
    ).toThrow("projected_runs");
  });

  it("accepts null for nullable fields (projected_total_std, over_probability, under_probability)", () => {
    const base = validGameProjection();
    // These are already null in the fixture; this is an explicit contract assertion
    expect(() => parseGameProjection(base)).not.toThrow();
    expect(base.projected_total_std).toBeNull();
    expect(base.over_probability).toBeNull();
    expect(base.under_probability).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseAssembledGameProjection — fail-closed: structural violations
// ---------------------------------------------------------------------------

describe("parseAssembledGameProjection — fail-closed", () => {
  const validAssembled = () => assembleGameProjection(prepared);

  it("throws when the root value is not an object", () => {
    expect(() => parseAssembledGameProjection(null)).toThrow("must be an object");
    expect(() => parseAssembledGameProjection([])).toThrow("must be an object");
  });

  it("throws when game_projection is missing", () => {
    const base = validAssembled();
    expect(() =>
      parseAssembledGameProjection({ ...base, game_projection: null })
    ).toThrow();
  });

  it("throws when away_batters is not an array", () => {
    const base = validAssembled();
    expect(() =>
      parseAssembledGameProjection({ ...base, away_batters: null })
    ).toThrow("away_batters must be an array");
  });

  it("throws when home_batters is not an array", () => {
    const base = validAssembled();
    expect(() =>
      parseAssembledGameProjection({ ...base, home_batters: "wrong" })
    ).toThrow("home_batters must be an array");
  });

  it("throws and names the index when a batter is invalid", () => {
    const base = validAssembled();
    const brokenBatters = [
      ...base.away_batters.slice(0, 2),
      { ...base.away_batters[2]!, player_id: "" },
      ...base.away_batters.slice(3)
    ];
    expect(() =>
      parseAssembledGameProjection({ ...base, away_batters: brokenBatters })
    ).toThrow("away_batters[2]");
  });

  it("accepts null for away_pitcher and home_pitcher", () => {
    const base = validAssembled();
    expect(() =>
      parseAssembledGameProjection({
        ...base,
        away_pitcher: null,
        home_pitcher: null
      })
    ).not.toThrow();
  });

  it("throws when a non-null pitcher block is missing projected_ip", () => {
    const base = validAssembled();
    expect(() =>
      parseAssembledGameProjection({
        ...base,
        away_pitcher: { ...base.away_pitcher!, projected_ip: NaN }
      })
    ).toThrow("projected_ip");
  });
});

// ---------------------------------------------------------------------------
// Hard schema lock: extraneous field rejection at every boundary
// ---------------------------------------------------------------------------

describe("extraneous field rejection", () => {
  const validAssembled = () => assembleGameProjection(prepared);
  const validGameProjection = () => validAssembled().game_projection;

  it("rejects extraneous fields at the assembled root", () => {
    const base = validAssembled();
    expect(() =>
      parseAssembledGameProjection({ ...base, invented_field: true })
    ).toThrow("assembled root has extraneous field(s): invented_field");
  });

  it("rejects extraneous fields at game_projection", () => {
    const base = validGameProjection();
    expect(() =>
      parseGameProjection({ ...base, extra_stat: 42 })
    ).toThrow("game_projection has extraneous field(s): extra_stat");
  });

  it("rejects extraneous fields at metadata", () => {
    const base = validGameProjection();
    expect(() =>
      parseGameProjection({
        ...base,
        metadata: { ...base.metadata, rogue_key: "x" }
      })
    ).toThrow("metadata has extraneous field(s): rogue_key");
  });

  it("rejects extraneous fields at metadata.version", () => {
    const base = validGameProjection();
    expect(() =>
      parseGameProjection({
        ...base,
        metadata: {
          ...base.metadata,
          version: { ...base.metadata.version, build_hash: "abc123" }
        }
      })
    ).toThrow("metadata.version has extraneous field(s): build_hash");
  });

  it("rejects extraneous fields at metadata.blocked", () => {
    const base = validGameProjection();
    expect(() =>
      parseGameProjection({
        ...base,
        metadata: {
          ...base.metadata,
          blocked: { ...base.metadata.blocked, severity: "high" }
        }
      })
    ).toThrow("metadata.blocked has extraneous field(s): severity");
  });

  it("rejects extraneous fields at away team projection", () => {
    const base = validGameProjection();
    expect(() =>
      parseGameProjection({
        ...base,
        away: { ...base.away, lineup_strength: 0.9 }
      })
    ).toThrow("team has extraneous field(s): lineup_strength");
  });

  it("rejects extraneous fields at home team projection", () => {
    const base = validGameProjection();
    expect(() =>
      parseGameProjection({
        ...base,
        home: { ...base.home, lineup_strength: 0.9 }
      })
    ).toThrow("team has extraneous field(s): lineup_strength");
  });

  it("rejects extraneous fields at pitcher projection", () => {
    const base = validAssembled();
    expect(() =>
      parseAssembledGameProjection({
        ...base,
        away_pitcher: { ...base.away_pitcher!, pitch_mix: "fastball" }
      })
    ).toThrow("pitcher has extraneous field(s): pitch_mix");
  });

  it("rejects extraneous fields at batter projection", () => {
    const base = validAssembled();
    const brokenBatters = [
      { ...base.away_batters[0]!, clutch_rating: 99 },
      ...base.away_batters.slice(1)
    ];
    expect(() =>
      parseAssembledGameProjection({ ...base, away_batters: brokenBatters })
    ).toThrow("batter has extraneous field(s): clutch_rating");
  });
});
