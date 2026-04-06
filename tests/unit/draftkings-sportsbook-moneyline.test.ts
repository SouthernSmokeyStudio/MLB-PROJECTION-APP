import { afterEach, describe, expect, it, vi } from "vitest";
import rawFixture from "../../data/fixtures/sample-raw-game.json";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import { parseMlbStatsApiGamePayload } from "../../lib/adapters/mlbStatsApi";
import {
  fetchDraftKingsSportsbookMlbMoneylineSlate,
  parseDraftKingsSportsbookMlbMoneylineSlate
} from "../../lib/adapters/draftKingsSportsbook";
import type { DraftKingsSportsbookMlbMoneylineSlate } from "../../lib/contracts/draftkings-sportsbook-mlb-moneyline";
import type { PreparedGameInputs } from "../../lib/contracts/prepared";
import { asISOTimestamp } from "../../lib/contracts/types";
import { normalizeMlbStatsApiGame } from "../../lib/normalization/mlbStatsApiNormalizer";
import { joinDraftKingsSportsbookMoneylines } from "../../lib/services/joinDraftKingsSportsbookMoneylines";
import { loadDraftKingsSportsbookMlbMoneylineSlate } from "../../lib/services/loadDraftKingsSportsbookMlbMoneylineSlate";

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
  playerIdentities: {}
};

const OFFICIAL_DRAFTKINGS_SPORTSBOOK_PAYLOAD = {
  sports: [],
  leagues: [],
  events: [
    {
      id: "33937444",
      seoIdentifier: "chi-cubs-%40-tb-rays",
      sportId: "7",
      leagueId: "84240",
      name: "CHI Cubs @ TB Rays",
      startEventDate: "2026-04-06T20:10:00.0000000Z",
      participants: [
        {
          id: "29880",
          name: "TB Rays",
          venueRole: "Home",
          type: "Team",
          metadata: {
            shortName: "TB",
            startingPitcherPlayerName: "Shane McClanahan"
          }
        },
        {
          id: "29894",
          name: "CHI Cubs",
          venueRole: "Away",
          type: "Team",
          metadata: {
            shortName: "CHC",
            startingPitcherPlayerName: "Jameson Taillon"
          }
        }
      ],
      eventParticipantType: "TwoTeam",
      status: "NOT_STARTED",
      metadata: {},
      sortOrder: 224185044,
      subscriptionKey: "events-46722213"
    }
  ],
  markets: [
    {
      id: "1_84191347",
      eventId: "33937444",
      sportId: "7",
      leagueId: "84240",
      name: "Moneyline",
      subcategoryId: "4519",
      marketType: {
        id: "1_0",
        betOfferTypeId: 2,
        name: "Moneyline"
      },
      subscriptionKey: "events-46722213",
      sortOrder: 184191347,
      tags: ["Default", "PrimaryMarket"]
    }
  ],
  selections: [
    {
      id: "0ML84191347_3",
      marketId: "1_84191347",
      label: "CHI Cubs",
      displayOdds: {
        american: "+104",
        decimal: "2.04"
      },
      trueOdds: 2.04,
      outcomeType: "Away",
      participants: [
        {
          id: "29894",
          name: "CHI Cubs",
          venueRole: "Away"
        }
      ],
      sortOrder: 3795774,
      tags: ["SGP"],
      metadata: {}
    },
    {
      id: "0ML84191347_1",
      marketId: "1_84191347",
      label: "TB Rays",
      displayOdds: {
        american: "\u2212126",
        decimal: "1.79"
      },
      trueOdds: 1.7936508,
      outcomeType: "Home",
      participants: [
        {
          id: "29880",
          name: "TB Rays",
          venueRole: "Home"
        }
      ],
      sortOrder: 3815770,
      tags: ["SGP"],
      metadata: {}
    }
  ],
  subscriptionPartials: {}
} as const;

const makeMoneylineSlate = (
  overrides: Partial<DraftKingsSportsbookMlbMoneylineSlate["entries"][number]>[] = []
): DraftKingsSportsbookMlbMoneylineSlate => {
  const baseEntry = {
    event_id: "33937444",
    market_id: "1_84191347",
    event_name: `${sourceGame.canonicalGame.away.team.abbreviation} @ ${sourceGame.canonicalGame.home.team.abbreviation}`,
    start_time: asISOTimestamp(sourceGame.canonicalGame.scheduled_start),
    away_team_abbreviation: sourceGame.canonicalGame.away.team.abbreviation,
    away_team_name: sourceGame.canonicalGame.away.team.full_name,
    away_starting_pitcher: parsed.data.teams.away.probablePitcher?.fullName ?? null,
    home_team_abbreviation: sourceGame.canonicalGame.home.team.abbreviation,
    home_team_name: sourceGame.canonicalGame.home.team.full_name,
    home_starting_pitcher: parsed.data.teams.home.probablePitcher?.fullName ?? null,
    away_odds_american: 110,
    away_odds_decimal: 2.1,
    home_odds_american: -130,
    home_odds_decimal: 1.77
  };

  return {
    provider: "draftkings-sportsbook",
    sport: "MLB",
    market_type: "moneyline",
    site: "US-TN-SB",
    league_id: "84240",
    subcategory_id: "4519",
    source: {
      provider: "draftkings-sportsbook",
      endpoint:
        "https://sportsbook-nash.draftkings.com/sites/US-TN-SB/api/sportscontent/controldata/league/leagueSubcategory/v1/markets",
      fetched_at: asISOTimestamp("2026-04-06T17:00:00Z"),
      raw_payload_hash: null
    },
    entries:
      overrides.length === 0
        ? [baseEntry]
        : overrides.map((override) => ({
            ...baseEntry,
            ...override
          }))
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DraftKings Sportsbook MLB moneyline prerequisite", () => {
  it("parses the official DraftKings Sportsbook moneyline payload into the repo contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => OFFICIAL_DRAFTKINGS_SPORTSBOOK_PAYLOAD
    });

    vi.stubGlobal("fetch", fetchMock);

    const loaded = await fetchDraftKingsSportsbookMlbMoneylineSlate();

    expect(loaded.success).toBe(true);

    if (!loaded.success) {
      throw new Error(loaded.error);
    }

    expect(loaded.data.provider).toBe("draftkings-sportsbook");
    expect(loaded.data.market_type).toBe("moneyline");
    expect(loaded.data.entries).toHaveLength(1);
    expect(loaded.data.entries[0]?.away_odds_american).toBe(104);
    expect(loaded.data.entries[0]?.home_odds_american).toBe(-126);
  });

  it("keeps only requested-date sportsbook moneyline rows", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...OFFICIAL_DRAFTKINGS_SPORTSBOOK_PAYLOAD,
        events: [
          ...OFFICIAL_DRAFTKINGS_SPORTSBOOK_PAYLOAD.events,
          {
            ...OFFICIAL_DRAFTKINGS_SPORTSBOOK_PAYLOAD.events[0],
            id: "33939999",
            startEventDate: "2026-04-07T20:10:00.0000000Z"
          }
        ],
        markets: [
          ...OFFICIAL_DRAFTKINGS_SPORTSBOOK_PAYLOAD.markets,
          {
            ...OFFICIAL_DRAFTKINGS_SPORTSBOOK_PAYLOAD.markets[0],
            id: "1_99999999",
            eventId: "33939999"
          }
        ],
        selections: [
          ...OFFICIAL_DRAFTKINGS_SPORTSBOOK_PAYLOAD.selections,
          {
            ...OFFICIAL_DRAFTKINGS_SPORTSBOOK_PAYLOAD.selections[0],
            id: "0ML99999999_3",
            marketId: "1_99999999"
          },
          {
            ...OFFICIAL_DRAFTKINGS_SPORTSBOOK_PAYLOAD.selections[1],
            id: "0ML99999999_1",
            marketId: "1_99999999"
          }
        ]
      })
    });

    vi.stubGlobal("fetch", fetchMock);

    const loaded = await loadDraftKingsSportsbookMlbMoneylineSlate({
      date: "2026-04-06"
    });

    expect(loaded.success).toBe(true);

    if (!loaded.success) {
      throw new Error(loaded.error);
    }

    expect(loaded.data.moneyline_slate?.entries).toHaveLength(1);
    expect(loaded.data.moneyline_slate?.entries[0]?.start_time.slice(0, 10)).toBe("2026-04-06");
  });

  it("attaches sportsbook moneyline edge when the join succeeds", () => {
    const joined = joinDraftKingsSportsbookMoneylines({
      sourceGames: [sourceGame],
      moneylineSlate: makeMoneylineSlate(),
      options: {
        simulation: {
          seed: 17,
          iterations: 250
        }
      }
    });

    expect(joined.ready_games).toBe(1);
    expect(joined.held_games).toBe(0);

    const first = joined.games[0];
    expect(first?.draftkings_sportsbook_moneyline.blocked.is_blocked).toBe(false);
    expect(first?.market?.moneyline).not.toBeNull();
    expect(first?.market?.total).toBeNull();
    expect(first?.market?.moneyline?.away.model_probability).toBeGreaterThanOrEqual(0);
    expect(first?.market?.moneyline?.away.model_probability).toBeLessThanOrEqual(1);
    expect(first?.market?.moneyline?.home.no_vig_edge).not.toBeNull();
  });

  it("keeps the game row held when the sportsbook moneyline join fails", () => {
    const joined = joinDraftKingsSportsbookMoneylines({
      sourceGames: [sourceGame],
      moneylineSlate: makeMoneylineSlate([
        {
          away_team_abbreviation: "LAD",
          home_team_abbreviation: "SD"
        }
      ]),
      options: {
        simulation: {
          seed: 17,
          iterations: 250
        }
      }
    });

    const first = joined.games[0];

    expect(joined.ready_games).toBe(0);
    expect(joined.held_games).toBe(1);
    expect(first?.draftkings_sportsbook_moneyline.blocked.is_blocked).toBe(true);
    expect(first?.market).toBeNull();
    expect(first?.draftkings_sportsbook_moneyline.blocked.blocked_reason).toContain("missing");
  });

  it("keeps the game row held when the sportsbook start time does not cleanly match", () => {
    const joined = joinDraftKingsSportsbookMoneylines({
      sourceGames: [sourceGame],
      moneylineSlate: makeMoneylineSlate([
        {
          start_time: asISOTimestamp("2026-03-27T22:35:00Z")
        }
      ]),
      options: {
        simulation: {
          seed: 17,
          iterations: 250
        }
      }
    });

    const first = joined.games[0];

    expect(joined.ready_games).toBe(0);
    expect(joined.held_games).toBe(1);
    expect(first?.draftkings_sportsbook_moneyline.blocked.is_blocked).toBe(true);
    expect(first?.market).toBeNull();
    expect(first?.draftkings_sportsbook_moneyline.blocked.blocked_reason).toContain("missing");
  });

  it("derives edge only when one clean sportsbook moneyline match exists", () => {
    const joined = joinDraftKingsSportsbookMoneylines({
      sourceGames: [sourceGame],
      moneylineSlate: makeMoneylineSlate([
        {},
        {
          event_id: "33937777",
          market_id: "1_84199999"
        }
      ]),
      options: {
        simulation: {
          seed: 17,
          iterations: 250
        }
      }
    });

    const first = joined.games[0];

    expect(joined.ready_games).toBe(0);
    expect(joined.held_games).toBe(1);
    expect(first?.draftkings_sportsbook_moneyline.blocked.is_blocked).toBe(true);
    expect(first?.draftkings_sportsbook_moneyline.blocked.blocked_reason).toContain(
      "ambiguous"
    );
    expect(first?.market).toBeNull();
  });

  it("parses the contract directly without fetch-side invention", () => {
    const parsedSlate = parseDraftKingsSportsbookMlbMoneylineSlate({
      fetchedAt: asISOTimestamp("2026-04-06T17:00:00Z"),
      payload: OFFICIAL_DRAFTKINGS_SPORTSBOOK_PAYLOAD
    });

    expect(parsedSlate.success).toBe(true);

    if (!parsedSlate.success) {
      throw new Error(parsedSlate.error);
    }

    expect(parsedSlate.data.entries[0]?.event_name).toBe("CHI Cubs @ TB Rays");
    expect(parsedSlate.data.entries[0]?.home_team_abbreviation).toBe("TB");
  });
});
