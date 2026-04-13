import { describe, expect, it } from "vitest";
import rawFixture from "../../data/fixtures/sample-raw-game.json";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import type { PreparedGameInputs } from "../../lib/contracts/prepared";
import { parseMlbStatsApiGamePayload } from "../../lib/adapters/mlbStatsApi";
import { normalizeMlbStatsApiGame } from "../../lib/normalization/mlbStatsApiNormalizer";
import { buildDfsEdgeBoard } from "../../lib/services/buildDfsEdgeBoard";

const prepared = preparedFixture as unknown as PreparedGameInputs;

const parsed = parseMlbStatsApiGamePayload(rawFixture);
if (!parsed.success) throw new Error(parsed.error);

const normalized = normalizeMlbStatsApiGame(parsed.data);
if (!normalized.success) throw new Error(normalized.error);

const sourceGame = {
  parsedGame: parsed.data,
  canonicalGame: normalized.data,
  preparedGame: prepared,
  liveScoreState: {
    away_score: null,
    home_score: null,
    inning_number: null,
    inning_state: null,
    is_live: false,
    is_final: false,
    display_state: "Scheduled"
  },
  playerIdentities: {}
} as const;

const counts = {
  fetched_raw: 1,
  parsed: 1,
  normalized: 1,
  prepared: 1,
  boxscore_enriched: 1
} as const;

const BASE_OPTS = {
  source: "test-degraded",
  date: "2026-03-27",
  generated_at: "2026-03-27T15:00:00Z",
  counts,
  note: "Salary unavailable for this date."
} as const;

describe("buildDfsEdgeBoard — salary-degraded mode (no draftkings_classic)", () => {
  it("returns null draftkings_classic header when no contest options supplied", () => {
    const payload = buildDfsEdgeBoard([sourceGame], BASE_OPTS);
    expect(payload.draftkings_classic).toBeNull();
  });

  it("has no ready pitchers or batters — all rows go to held_players", () => {
    const payload = buildDfsEdgeBoard([sourceGame], BASE_OPTS);
    expect(payload.summary.ready_players).toBe(0);
    expect(payload.ready_pitchers).toHaveLength(0);
    expect(payload.ready_batters).toHaveLength(0);
    expect(payload.held_players.length).toBeGreaterThan(0);
  });

  it("stamps every held row with salary-unavailable blocked reason", () => {
    const payload = buildDfsEdgeBoard([sourceGame], BASE_OPTS);
    for (const row of payload.held_players) {
      expect(row.draftkings_classic.blocked.is_blocked).toBe(true);
      expect(row.draftkings_classic.blocked.blocked_reason).toBe("salary-unavailable");
    }
  });

  it("emits zero salary_entries and matched_salaries in counts", () => {
    const payload = buildDfsEdgeBoard([sourceGame], BASE_OPTS);
    expect(payload.counts.salary_entries).toBe(0);
    expect(payload.counts.matched_salaries).toBe(0);
  });

  it("does not change ready-mode behaviour when draftkings_classic is supplied", () => {
    const payload = buildDfsEdgeBoard([sourceGame], {
      ...BASE_OPTS,
      draftkings_classic: {
        draft_group_id: "145020",
        label: "DraftKings Classic",
        min_start_time: "2026-03-27T19:05:00Z",
        max_start_time: "2026-03-27T23:00:00Z",
        tags: []
      }
    });
    // Contest header is populated when draftkings_classic is provided
    expect(payload.draftkings_classic).not.toBeNull();
    expect(payload.draftkings_classic?.draft_group_id).toBe("145020");
  });
});
