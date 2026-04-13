import { describe, expect, it } from "vitest";
import rawFixture from "../../data/fixtures/sample-raw-game.json";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import type { PreparedGameInputs } from "../../lib/contracts/prepared";
import type { DraftKingsSportsbookMlbMoneylineSlate } from "../../lib/contracts/draftkings-sportsbook-mlb-moneyline";
import { asISOTimestamp } from "../../lib/contracts/types";
import { parseMlbStatsApiGamePayload } from "../../lib/adapters/mlbStatsApi";
import { normalizeMlbStatsApiGame } from "../../lib/normalization/mlbStatsApiNormalizer";
import { buildBettingEdgeBoard } from "../../lib/services/buildBettingEdgeBoard";

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
  note: "Market data unavailable for this date.",
  draftkings_sportsbook_moneyline: {
    site: "US-TN-SB" as const,
    label: "DraftKings Sportsbook MLB Pregame Moneyline"
  }
} as const;

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

describe("buildBettingEdgeBoard — market-degraded mode (no moneyline_slate)", () => {
  it("returns null draftkings_sportsbook_moneyline header when no slate supplied", () => {
    const payload = buildBettingEdgeBoard([sourceGame], BASE_OPTS);
    expect(payload.draftkings_sportsbook_moneyline).toBeNull();
  });

  it("emits one held row per source game", () => {
    const payload = buildBettingEdgeBoard([sourceGame], BASE_OPTS);
    expect(payload.ready_games).toHaveLength(0);
    expect(payload.held_games).toHaveLength(1);
    expect(payload.summary.total_games).toBe(1);
    expect(payload.summary.ready_games).toBe(0);
  });

  it("stamps every held row with market-unavailable blocked reason", () => {
    const payload = buildBettingEdgeBoard([sourceGame], BASE_OPTS);
    for (const row of payload.held_games) {
      expect(row.draftkings_sportsbook_moneyline.blocked.is_blocked).toBe(true);
      expect(row.draftkings_sportsbook_moneyline.blocked.blocked_reason).toBe(
        "market-unavailable"
      );
    }
  });

  it("still carries projection data in degraded rows", () => {
    const payload = buildBettingEdgeBoard([sourceGame], BASE_OPTS);
    const row = payload.held_games[0]!;
    // Moneyline odds are null
    expect(row.draftkings_sportsbook_moneyline.away_odds_american).toBeNull();
    expect(row.draftkings_sportsbook_moneyline.home_odds_american).toBeNull();
    // Game identity fields are populated from source game
    expect(row.matchup).toBeTruthy();
    expect(row.scheduled_start).toBeTruthy();
  });

  it("emits zero moneyline_entries and matched_markets in counts", () => {
    const payload = buildBettingEdgeBoard([sourceGame], BASE_OPTS);
    expect(payload.counts.moneyline_entries).toBe(0);
    expect(payload.counts.matched_markets).toBe(0);
  });

  it("does not change ready-mode behaviour when moneyline_slate is supplied", () => {
    const payload = buildBettingEdgeBoard([sourceGame], {
      ...BASE_OPTS,
      moneyline_slate: makeMoneylineSlate()
    });
    // Sportsbook header is populated when moneyline_slate is provided
    expect(payload.draftkings_sportsbook_moneyline).not.toBeNull();
    expect(payload.draftkings_sportsbook_moneyline?.site).toBe("US-TN-SB");
  });
});
