import { describe, expect, it } from "vitest";
import rawFixture from "../../data/fixtures/sample-raw-game.json";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import type { DraftKingsClassicSalarySlate } from "../../lib/contracts/draftkings-classic";
import type { DraftKingsSportsbookMlbMoneylineSlate } from "../../lib/contracts/draftkings-sportsbook-mlb-moneyline";
import type { PreparedGameInputs } from "../../lib/contracts/prepared";
import type { PlayerCrosswalkEntry } from "../../lib/contracts/player-crosswalk";
import { asISOTimestamp } from "../../lib/contracts/types";
import { parseMlbStatsApiGamePayload } from "../../lib/adapters/mlbStatsApi";
import { normalizeMlbStatsApiGame } from "../../lib/normalization/mlbStatsApiNormalizer";
import { parseSlateSnapshotPayload, getSlateSnapshotBlockedSections } from "../../lib/slate-snapshot";
import { buildSlateSnapshot } from "../../lib/services/buildSlateSnapshot";
import { indexCrosswalk } from "../../lib/crosswalk/resolvePlayerIdentity";
import { assembleGameProjection } from "../../lib/projections/assembleGameProjection";

const prepared = preparedFixture as unknown as PreparedGameInputs;

const parsed = parseMlbStatsApiGamePayload(rawFixture);
if (!parsed.success) {
  throw new Error(parsed.error);
}

const normalized = normalizeMlbStatsApiGame(parsed.data);
if (!normalized.success) {
  throw new Error(normalized.error);
}

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
  playerIdentities: {
    "gerrit-cole": {
      player_id: "gerrit-cole" as never,
      full_name: "Gerrit Cole",
      position: "P" as const,
      batting_order: null
    },
    "chris-sale": {
      player_id: "chris-sale" as never,
      full_name: "Chris Sale",
      position: "P" as const,
      batting_order: null
    },
    "nyy-1": {
      player_id: "nyy-1" as never,
      full_name: "Aaron Judge",
      position: "RF" as const,
      batting_order: 1
    },
    "bos-1": {
      player_id: "bos-1" as never,
      full_name: "Jarren Duran",
      position: "LF" as const,
      batting_order: 1
    }
  }
} as const;

const counts = {
  fetched_raw: 1,
  parsed: 1,
  normalized: 1,
  prepared: 1,
  boxscore_enriched: 1
} as const;

const makeSalarySlate = (): DraftKingsClassicSalarySlate => ({
  provider: "draftkings",
  contest_type: "classic",
  draft_group_id: "145020",
  source: {
    provider: "draftkings",
    endpoint: "https://api.draftkings.com/draftgroups/v1/145020",
    fetched_at: asISOTimestamp("2026-03-27T15:35:00Z"),
    raw_payload_hash: null
  },
  salaries: [
    {
      draftable_id: "42538654",
      // BF-003: DK salary entries use numeric MLB Stats API IDs — join resolves via mlb_stats_api_id
      player_id: "543037" as never,
      player_dk_id: "dk-gerrit-cole",
      display_name: "Gerrit Cole",
      short_name: "G. Cole",
      position: "P",
      roster_slot_id: 1,
      salary: 10200,
      team_abbreviation: "NYY",
      competition_id: "822758",
      competition_name: "NYY @ BOS",
      competition_start: asISOTimestamp("2026-03-27T19:05:00Z")
    },
    {
      draftable_id: "42538655",
      player_id: "nyy-1" as never,
      player_dk_id: "dk-aaron-judge",
      display_name: "Aaron Judge",
      short_name: "A. Judge",
      position: "OF",
      roster_slot_id: 7,
      salary: 5600,
      team_abbreviation: "NYY",
      competition_id: "822758",
      competition_name: "NYY @ BOS",
      competition_start: asISOTimestamp("2026-03-27T19:05:00Z")
    },
    {
      draftable_id: "42539999",
      player_id: "bos-1" as never,
      player_dk_id: "dk-jarren-duran",
      display_name: "Jarren Duran",
      short_name: "J. Duran",
      position: "OF",
      roster_slot_id: 8,
      salary: 4800,
      team_abbreviation: "BOS",
      competition_id: "822758",
      competition_name: "NYY @ BOS",
      competition_start: asISOTimestamp("2026-03-27T19:05:00Z")
    }
  ]
});

const makeMoneylineSlate = (): DraftKingsSportsbookMlbMoneylineSlate => ({
  provider: "draftkings-sportsbook",
  sport: "MLB",
  market_type: "moneyline",
  site: "US-TN-SB",
  league_id: "84240",
  subcategory_id: "4519",
  source: {
    provider: "draftkings-sportsbook",
    endpoint: "https://sportsbook.example.test/moneyline",
    fetched_at: asISOTimestamp("2026-03-27T15:35:00Z"),
    raw_payload_hash: null
  },
  entries: [
    {
      event_id: "33937444",
      market_id: "1_84191347",
      event_name: "NYY @ BOS",
      start_time: asISOTimestamp("2026-03-27T19:05:00Z"),
      away_team_abbreviation: "NYY",
      away_team_name: "New York Yankees",
      away_starting_pitcher: "Gerrit Cole",
      home_team_abbreviation: "BOS",
      home_team_name: "Boston Red Sox",
      home_starting_pitcher: "Chris Sale",
      away_odds_american: 110,
      away_odds_decimal: 2.1,
      home_odds_american: -130,
      home_odds_decimal: 1.77
    }
  ]
});

/**
 * Build a test crosswalk with linked dk_player_ids that match the salary slate.
 *
 * Salary slate uses player_id "543037" (Cole) and "nyy-1" (Judge).
 * Crosswalk entries have dk_player_id values matching those salary keys.
 */
const makeLinkedTestCrosswalk = () => {
  const makeEntry = (
    overrides: Partial<PlayerCrosswalkEntry> & Pick<PlayerCrosswalkEntry, "canonical_player_id" | "mlb_stats_api_id" | "display_name" | "team_abbreviation">
  ): PlayerCrosswalkEntry => ({
    normalized_name: overrides.display_name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z]/g, "")
      .toLowerCase(),
    position: "P",
    throws: "R",
    seeded_at: "2026-04-10T00:00:00Z",
    dk_player_id: null,
    dk_player_dk_id: null,
    rotowire_slug: null,
    linked_at: null,
    linked_via: null,
    ...overrides
  });

  return indexCrosswalk({
    version: 1,
    generated_at: "2026-04-10T00:00:00Z",
    entry_count: 2,
    entries: [
      makeEntry({
        canonical_player_id: "mlb-543037",
        mlb_stats_api_id: "543037",
        display_name: "Gerrit Cole",
        team_abbreviation: "NYY",
        dk_player_id: "543037",
        linked_at: "2026-04-10T00:00:00Z",
        linked_via: "manual"
      }),
      makeEntry({
        canonical_player_id: "mlb-592450",
        mlb_stats_api_id: "592450",
        display_name: "Aaron Judge",
        team_abbreviation: "NYY",
        position: "RF",
        dk_player_id: "nyy-1",
        linked_at: "2026-04-10T00:00:00Z",
        linked_via: "manual"
      })
    ]
  });
};

describe("slate snapshot scaffolding", () => {
  it("wraps schedule and player boards while publishing a partial smoke signal", () => {
    const snapshot = buildSlateSnapshot([sourceGame], {
      source: "mlb-statsapi-live",
      date: "2026-03-27",
      generated_at: "2026-03-27T15:30:00Z",
      counts,
      simulation: {
        seed: 7,
        iterations: 100
      }
    });

    expect(snapshot.mode).toBe("slate-snapshot-v1");
    expect(snapshot.version).toBe(1);
    expect(snapshot.schedule.payload?.mode).toBe("schedule-board-v1");
    expect(snapshot.player_projections.payload?.mode).toBe("player-board-v1");
    expect(snapshot.schedule.status.state).toBe("ready");
    expect(snapshot.player_projections.status.state).toBe("ready");
    expect(snapshot.dfs_edge.status.state).toBe("blocked");
    expect(snapshot.betting_edge.status.state).toBe("blocked");
    expect(snapshot.smoke_signal.status.state).toBe("partial");
    expect(snapshot.smoke_signal.payload?.mode).toBe("smoke-signal-v1");
    expect(snapshot.smoke_signal.payload?.top_projected_total_game?.projected_total).toBeGreaterThan(0);
    expect(snapshot.smoke_signal.payload?.top_projected_player?.projected_points).toBeGreaterThan(0);
    expect(snapshot.smoke_signal.payload?.top_dfs_value_player).toBeNull();
    expect(snapshot.live_scoreboard.status.state).toBe("ready");
    expect(snapshot.live_scoreboard.payload?.mode).toBe("live-scoreboard-v1");
    expect(snapshot.live_scoreboard.payload?.games).toHaveLength(1);
    expect(getSlateSnapshotBlockedSections(snapshot)).toEqual(["dfs_edge", "betting_edge"]);
    expect(snapshot.publication.is_complete).toBe(false);
  });

  it("wraps downstream DFS and betting payloads when source slates are supplied", () => {
    const snapshot = buildSlateSnapshot([sourceGame], {
      source: "mlb-statsapi-live",
      date: "2026-03-27",
      generated_at: "2026-03-27T15:30:00Z",
      counts,
      simulation: {
        seed: 7,
        iterations: 100
      },
      dfs_edge: {
        source: "mlb-statsapi-live+draftkings-classic",
        note: null,
        crosswalk: makeLinkedTestCrosswalk(),
        draftkings_classic: {
          draft_group_id: "145020",
          label: "Featured DraftKings Classic",
          min_start_time: "2026-03-27T19:05:00Z",
          max_start_time: "2026-03-27T19:05:00Z",
          tags: ["Featured"]
        },
        salary_slate: makeSalarySlate()
      },
      betting_edge: {
        source: "mlb-statsapi-live+draftkings-sportsbook-moneyline",
        note: null,
        draftkings_sportsbook_moneyline: {
          site: "US-TN-SB",
          label: "DraftKings Sportsbook MLB Pregame Moneyline"
        },
        moneyline_slate: makeMoneylineSlate()
      }
    });

    expect(snapshot.dfs_edge.payload?.mode).toBe("dfs-edge-board-v1");
    expect(snapshot.betting_edge.payload?.mode).toBe("betting-edge-board-v1");
    expect(snapshot.dfs_edge.status.state).toBe("partial");
    expect(snapshot.betting_edge.status.state).toBe("ready");
    expect(snapshot.smoke_signal.status.state).toBe("ready");
    expect(snapshot.smoke_signal.payload?.top_dfs_value_player?.ownership_source).toBe("placeholder");
    expect(snapshot.smoke_signal.payload?.top_betting_edge_side?.edge).not.toBeNull();
    expect(snapshot.dfs_edge.payload?.summary.ready_players).toBeGreaterThan(0);
    expect(snapshot.betting_edge.payload?.summary.ready_games).toBeGreaterThan(0);
    expect(snapshot.live_scoreboard.payload?.summary.total_games).toBe(1);
    expect(
      snapshot.dfs_edge.payload?.ready_pitchers[0]?.draftkings_classic.ownership_source
    ).toBe("placeholder");
    expect(
      snapshot.dfs_edge.payload?.ready_pitchers[0]?.draftkings_classic.projected_ownership
    ).toBeGreaterThanOrEqual(0);
    expect(
      snapshot.dfs_edge.payload?.ready_pitchers[0]?.draftkings_classic.projected_ownership
    ).toBeLessThanOrEqual(1);
    expect(
      snapshot.dfs_edge.payload?.held_players[0]?.draftkings_classic.projected_ownership
    ).toBeNull();
  });

  it("parses the wrapped snapshot payload through the reader path", () => {
    const snapshot = buildSlateSnapshot([sourceGame], {
      source: "mlb-statsapi-live",
      date: "2026-03-27",
      generated_at: "2026-03-27T15:30:00Z",
      counts,
      simulation: {
        seed: 7,
        iterations: 100
      },
      dfs_edge: {
        source: "mlb-statsapi-live+draftkings-classic",
        note: null,
        crosswalk: makeLinkedTestCrosswalk(),
        draftkings_classic: {
          draft_group_id: "145020",
          label: "Featured DraftKings Classic",
          min_start_time: "2026-03-27T19:05:00Z",
          max_start_time: "2026-03-27T19:05:00Z",
          tags: ["Featured"]
        },
        salary_slate: makeSalarySlate()
      },
      betting_edge: {
        source: "mlb-statsapi-live+draftkings-sportsbook-moneyline",
        note: null,
        draftkings_sportsbook_moneyline: {
          site: "US-TN-SB",
          label: "DraftKings Sportsbook MLB Pregame Moneyline"
        },
        moneyline_slate: makeMoneylineSlate()
      }
    });

    const parsedSnapshot = parseSlateSnapshotPayload(snapshot);

    expect(parsedSnapshot.mode).toBe("slate-snapshot-v1");
    expect(parsedSnapshot.schedule.payload?.games).toHaveLength(1);
    expect(parsedSnapshot.player_projections.payload?.players.length).toBeGreaterThan(0);
    expect(parsedSnapshot.dfs_edge.payload?.ready_pitchers.length).toBeGreaterThan(0);
    expect(parsedSnapshot.betting_edge.payload?.ready_games.length).toBeGreaterThan(0);
    expect(parsedSnapshot.smoke_signal.payload?.mode).toBe("smoke-signal-v1");
    expect(parsedSnapshot.smoke_signal.payload?.top_projected_total_game?.projected_total).toBeGreaterThan(0);
    expect(parsedSnapshot.live_scoreboard.payload?.games[0]?.display_state).toBe("Scheduled");
    expect(
      parsedSnapshot.dfs_edge.payload?.ready_pitchers[0]?.draftkings_classic.ownership_source
    ).toBe("placeholder");
    expect(parsedSnapshot.live_scoreboard.payload?.mode).toBe("live-scoreboard-v1");
  });

  it("linked crosswalk-resolved player reaches salary through the active caller path", () => {
    const crosswalk = makeLinkedTestCrosswalk();

    const snapshot = buildSlateSnapshot([sourceGame], {
      source: "mlb-statsapi-live",
      date: "2026-03-27",
      generated_at: "2026-03-27T15:30:00Z",
      counts,
      simulation: { seed: 7, iterations: 100 },
      dfs_edge: {
        source: "mlb-statsapi-live+draftkings-classic",
        note: null,
        crosswalk,
        draftkings_classic: {
          draft_group_id: "145020",
          label: "Featured DraftKings Classic",
          min_start_time: "2026-03-27T19:05:00Z",
          max_start_time: "2026-03-27T19:05:00Z",
          tags: ["Featured"]
        },
        salary_slate: makeSalarySlate()
      }
    });

    // Cole resolves via mlb_stats_api_id → dk_player_id "543037" → salary 10200
    const readyPitcher = snapshot.dfs_edge.payload?.ready_pitchers[0];
    expect(readyPitcher).toBeDefined();
    expect(readyPitcher?.draftkings_classic.blocked.is_blocked).toBe(false);
    expect(readyPitcher?.draftkings_classic.salary).toBe(10200);

    // Judge (nyy-1) resolves via dk_player_id → salary 5600
    const readyBatter = snapshot.dfs_edge.payload?.ready_batters.find(
      (b) => b.draftkings_classic.salary === 5600
    );
    expect(readyBatter).toBeDefined();
    expect(readyBatter?.draftkings_classic.blocked.is_blocked).toBe(false);

    // Unresolved players are held
    expect(snapshot.dfs_edge.payload?.held_players.length).toBeGreaterThan(0);
    expect(
      snapshot.dfs_edge.payload?.held_players.every(
        (p) => p.draftkings_classic.blocked.is_blocked
      )
    ).toBe(true);
  });

  it("auto-load skips crosswalk when committed file has no linked dk_player_ids", () => {
    // No crosswalk supplied — auto-loads from data/crosswalk/player-crosswalk.json.
    // Committed crosswalk has dk_player_id: null for ALL entries, so the linked-entry
    // guard skips it. The legacy salary join path runs and matches normally.
    const snapshot = buildSlateSnapshot([sourceGame], {
      source: "mlb-statsapi-live",
      date: "2026-03-27",
      generated_at: "2026-03-27T15:30:00Z",
      counts,
      simulation: { seed: 7, iterations: 100 },
      dfs_edge: {
        source: "mlb-statsapi-live+draftkings-classic",
        note: null,
        draftkings_classic: {
          draft_group_id: "145020",
          label: "Featured DraftKings Classic",
          min_start_time: "2026-03-27T19:05:00Z",
          max_start_time: "2026-03-27T19:05:00Z",
          tags: ["Featured"]
        },
        salary_slate: makeSalarySlate()
      }
    });

    // Legacy join path runs — ready players matched via mlb_stats_api_id / player_id
    expect(snapshot.dfs_edge.payload?.summary.ready_players).toBeGreaterThan(0);
    expect(snapshot.dfs_edge.status.state).toBe("partial");
  });

  it("explicitly-supplied unlinked crosswalk holds resolved players", () => {
    // Crosswalk supplied directly with dk_player_id: null for all entries.
    // Unlike auto-load, explicit supply always activates the crosswalk path.
    const unlinkedCrosswalk = indexCrosswalk({
      version: 1,
      generated_at: "2026-04-10T00:00:00Z",
      entry_count: 1,
      entries: [{
        canonical_player_id: "mlb-543037",
        mlb_stats_api_id: "543037",
        display_name: "Gerrit Cole",
        normalized_name: "gerritcole",
        team_abbreviation: "NYY",
        position: "P",
        throws: "R",
        seeded_at: "2026-04-10T00:00:00Z",
        dk_player_id: null,
        dk_player_dk_id: null,
        rotowire_slug: null,
        linked_at: null,
        linked_via: null
      }]
    });

    const snapshot = buildSlateSnapshot([sourceGame], {
      source: "mlb-statsapi-live",
      date: "2026-03-27",
      generated_at: "2026-03-27T15:30:00Z",
      counts,
      simulation: { seed: 7, iterations: 100 },
      dfs_edge: {
        source: "mlb-statsapi-live+draftkings-classic",
        note: null,
        crosswalk: unlinkedCrosswalk,
        draftkings_classic: {
          draft_group_id: "145020",
          label: "Featured DraftKings Classic",
          min_start_time: "2026-03-27T19:05:00Z",
          max_start_time: "2026-03-27T19:05:00Z",
          tags: ["Featured"]
        },
        salary_slate: makeSalarySlate()
      }
    });

    // Crosswalk active: all players resolved-but-unlinked or unresolved → held
    expect(snapshot.dfs_edge.payload?.summary.ready_pitchers).toBe(0);
    expect(snapshot.dfs_edge.payload?.summary.ready_batters).toBe(0);
    expect(snapshot.dfs_edge.payload?.summary.held_players).toBeGreaterThan(0);
    expect(snapshot.dfs_edge.status.state).toBe("partial");

    // Verify held reason includes the crosswalk-specific message
    const heldPitcher = snapshot.dfs_edge.payload?.held_players.find(
      (p) => p.projection.deterministic_summary?.kind === "pitcher"
    );
    expect(heldPitcher?.draftkings_classic.blocked.is_blocked).toBe(true);
    expect(heldPitcher?.draftkings_classic.blocked.blocked_reason).toContain("Crosswalk");
  });
});

describe("buildSlateSnapshot preassembled threading", () => {
  it("uses preassembled projections instead of recomputing when provided", () => {
    // Build the real assembled projection once.
    const realAssembled = assembleGameProjection(sourceGame.preparedGame);

    // Override projected_total with a sentinel value to prove the preassembled
    // map is actually used — if buildSlateSnapshot recomputes from scratch, the
    // sentinel would not appear and the assertion would fail.
    const SENTINEL_TOTAL = 33.33;
    const modifiedAssembled = {
      ...realAssembled,
      game_projection: {
        ...realAssembled.game_projection,
        projected_total: SENTINEL_TOTAL,
        away: {
          ...realAssembled.game_projection.away,
          projected_runs: SENTINEL_TOTAL / 2
        },
        home: {
          ...realAssembled.game_projection.home,
          projected_runs: SENTINEL_TOTAL / 2
        }
      }
    };

    const preassembled = new Map([
      [sourceGame.canonicalGame.game_id, modifiedAssembled as typeof realAssembled]
    ]);

    const snapshot = buildSlateSnapshot([sourceGame], {
      source: "mlb-statsapi-live",
      date: "2026-03-27",
      generated_at: "2026-03-27T15:30:00Z",
      counts,
      preassembled,
      simulation: { seed: 7, iterations: 100 }
    });

    // The sentinel value must surface in the smoke signal's top projected total,
    // proving the preassembled projection was threaded through the pipeline
    // rather than recomputed from prepared inputs.
    expect(snapshot.smoke_signal.payload?.top_projected_total_game?.projected_total).toBe(SENTINEL_TOTAL);
    // Schedule board must also reflect the same parent truth.
    const scheduleGame = snapshot.schedule.payload?.games[0];
    expect(scheduleGame?.projection?.projected_total).toBe(SENTINEL_TOTAL);
  });

  it("falls back to fresh computation when preassembled map has no entry for a game", () => {
    const realAssembled = assembleGameProjection(sourceGame.preparedGame);
    const realTotal = realAssembled.game_projection.projected_total;

    // Provide a preassembled map that does NOT contain this game_id.
    const emptyPreassembled = new Map<string, typeof realAssembled>();

    const snapshot = buildSlateSnapshot([sourceGame], {
      source: "mlb-statsapi-live",
      date: "2026-03-27",
      generated_at: "2026-03-27T15:30:00Z",
      counts,
      preassembled: emptyPreassembled,
      simulation: { seed: 7, iterations: 100 }
    });

    // Should fall back to assembleGameProjection and produce the same total
    // as the fresh computation path.
    expect(snapshot.smoke_signal.payload?.top_projected_total_game?.projected_total).toBe(realTotal);
  });
});
