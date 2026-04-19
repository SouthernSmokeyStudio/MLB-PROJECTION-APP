import { afterEach, describe, expect, it, vi } from "vitest";
import rawFixture from "../../data/fixtures/sample-raw-game.json";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import { parseMlbStatsApiGamePayload } from "../../lib/adapters/mlbStatsApi";
import {
  fetchDraftKingsSportsbookMlbMoneylineSlate,
  normalizeDkTeamAbbreviation,
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

// ---------------------------------------------------------------------------
// BF-004: DraftKings team abbreviation normalization
// ---------------------------------------------------------------------------

describe("BF-004 — DraftKings team abbreviation normalization", () => {
  it("normalizes DK shortName 'WAS' to canonical 'WSH'", () => {
    const result = normalizeDkTeamAbbreviation("WAS");
    expect(result.canonical).toBe("WSH");
    expect(result.drift_warning).toBeNull();
  });

  it("normalizes DK shortName 'A's' to canonical 'ATH'", () => {
    const result = normalizeDkTeamAbbreviation("A's");
    expect(result.canonical).toBe("ATH");
    expect(result.drift_warning).toBeNull();
  });

  it("normalizes DK shortName 'SFG' to canonical 'SF'", () => {
    const result = normalizeDkTeamAbbreviation("SFG");
    expect(result.canonical).toBe("SF");
    expect(result.drift_warning).toBeNull();
  });

  it("normalizes DK shortName 'NY' to canonical 'NYY' (New York Yankees)", () => {
    const result = normalizeDkTeamAbbreviation("NY");
    expect(result.canonical).toBe("NYY");
    expect(result.drift_warning).toBeNull();
  });

  it("passes through already-canonical 'LAA' unchanged", () => {
    const result = normalizeDkTeamAbbreviation("LAA");
    expect(result.canonical).toBe("LAA");
    expect(result.drift_warning).toBeNull();
  });

  it("passes through already-canonical 'CWS' unchanged (regression guard)", () => {
    const result = normalizeDkTeamAbbreviation("CWS");
    expect(result.canonical).toBe("CWS");
    expect(result.drift_warning).toBeNull();
  });

  it("emits drift warning for unrecognized shortName", () => {
    const result = normalizeDkTeamAbbreviation("XYZZY");
    expect(result.canonical).toBe("XYZZY");
    expect(result.drift_warning).toContain("Unrecognized");
    expect(result.drift_warning).toContain("XYZZY");
  });

  it("normalizes WAS at parse time so the contract carries canonical WSH", () => {
    const payload = buildDkPayloadWithShortNames("WAS", "NYY");
    const result = parseDraftKingsSportsbookMlbMoneylineSlate({
      fetchedAt: asISOTimestamp("2026-04-06T17:00:00Z"),
      payload
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.entries[0]?.away_team_abbreviation).toBe("WSH");
    expect(result.data.entries[0]?.home_team_abbreviation).toBe("NYY");
  });

  it("normalizes A's at parse time so the contract carries canonical ATH", () => {
    const payload = buildDkPayloadWithShortNames("A's", "SEA");
    const result = parseDraftKingsSportsbookMlbMoneylineSlate({
      fetchedAt: asISOTimestamp("2026-04-06T17:00:00Z"),
      payload
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.entries[0]?.away_team_abbreviation).toBe("ATH");
  });

  it("normalizes SFG at parse time so the contract carries canonical SF", () => {
    const payload = buildDkPayloadWithShortNames("SFG", "LAD");
    const result = parseDraftKingsSportsbookMlbMoneylineSlate({
      fetchedAt: asISOTimestamp("2026-04-06T17:00:00Z"),
      payload
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.entries[0]?.away_team_abbreviation).toBe("SF");
  });
});

// ---------------------------------------------------------------------------
// BF-004: parse-level normalization proof (adapter boundary only)
// ---------------------------------------------------------------------------

describe("BF-004 — adapter parse normalization", () => {
  it("DK shortName 'WAS' is normalized to 'WSH' in parsed contract", () => {
    const payload = buildDkPayloadWithShortNames("WAS", "NYY");
    const result = parseDraftKingsSportsbookMlbMoneylineSlate({
      fetchedAt: asISOTimestamp("2026-04-06T17:00:00Z"),
      payload
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.entries[0]?.away_team_abbreviation).toBe("WSH");
    expect(result.data.entries[0]?.home_team_abbreviation).toBe("NYY");
  });

  it("DK shortName 'SFG' is normalized to 'SF' in parsed contract", () => {
    const payload = buildDkPayloadWithShortNames("SFG", "LAD");
    const result = parseDraftKingsSportsbookMlbMoneylineSlate({
      fetchedAt: asISOTimestamp("2026-04-06T17:00:00Z"),
      payload
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.entries[0]?.away_team_abbreviation).toBe("SF");
  });

  it("DK shortName 'A's' is normalized to 'ATH' in parsed contract", () => {
    const payload = buildDkPayloadWithShortNames("A's", "SEA");
    const result = parseDraftKingsSportsbookMlbMoneylineSlate({
      fetchedAt: asISOTimestamp("2026-04-06T17:00:00Z"),
      payload
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.entries[0]?.away_team_abbreviation).toBe("ATH");
  });

  it("DK shortName 'NY' is normalized to 'NYY' in parsed contract", () => {
    const payload = buildDkPayloadWithShortNames("KC", "NY");
    const result = parseDraftKingsSportsbookMlbMoneylineSlate({
      fetchedAt: asISOTimestamp("2026-04-06T17:00:00Z"),
      payload
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.entries[0]?.away_team_abbreviation).toBe("KC");
    expect(result.data.entries[0]?.home_team_abbreviation).toBe("NYY");
  });

  it("drift visibility: console.warn fires for unrecognized shortName", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const payload = buildDkPayloadWithShortNames("XYZZY", "NYY");
    parseDraftKingsSportsbookMlbMoneylineSlate({
      fetchedAt: asISOTimestamp("2026-04-06T17:00:00Z"),
      payload
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[BF-004 drift]")
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("XYZZY")
    );

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// BF-004: end-to-end join proof — raw DK shortName → adapter parse →
// joinDraftKingsSportsbookMoneylines → ready_games === 1
//
// Each test constructs:
//   1. A raw DK payload with the mismatched shortName
//   2. Parses it through the adapter (normalization happens here)
//   3. A synthetic sourceGame whose canonical abbreviation is the canonical value
//   4. Feeds both into joinDraftKingsSportsbookMoneylines
//   5. Asserts ready_games === 1
//
// This proves the full path: raw DK → adapter → normalized slate → join succeeds.
// ---------------------------------------------------------------------------

/**
 * Build a synthetic LiveSlateSourceGame by cloning the fixture sourceGame
 * and overriding the canonical team abbreviations. The join only reads
 * canonicalGame.{away,home}.team.abbreviation, canonicalGame.scheduled_start,
 * and preparedGame (for GameCard building), so this is sufficient.
 */
const buildSourceGameWithTeams = (
  awayAbbreviation: string,
  homeAbbreviation: string,
  scheduledStart: string = sourceGame.canonicalGame.scheduled_start
) => ({
  ...sourceGame,
  canonicalGame: {
    ...sourceGame.canonicalGame,
    scheduled_start: asISOTimestamp(scheduledStart),
    away: {
      ...sourceGame.canonicalGame.away,
      team: {
        ...sourceGame.canonicalGame.away.team,
        abbreviation: awayAbbreviation
      }
    },
    home: {
      ...sourceGame.canonicalGame.home,
      team: {
        ...sourceGame.canonicalGame.home.team,
        abbreviation: homeAbbreviation
      }
    }
  }
});

describe("BF-004 — end-to-end join proof: raw DK shortName → parse → join succeeds", () => {
  it("raw DK 'WAS' → adapter normalizes to 'WSH' → join against canonical WSH succeeds", () => {
    // Step 1-2: Parse raw DK payload where away shortName is "WAS"
    const rawPayload = buildDkPayloadWithShortNames("WAS", "BOS");
    const parsedSlate = parseDraftKingsSportsbookMlbMoneylineSlate({
      fetchedAt: asISOTimestamp("2026-04-06T17:00:00Z"),
      payload: rawPayload
    });
    expect(parsedSlate.success).toBe(true);
    if (!parsedSlate.success) throw new Error(parsedSlate.error);

    // Verify normalization happened
    expect(parsedSlate.data.entries[0]?.away_team_abbreviation).toBe("WSH");

    // Step 3: Build sourceGame with canonical "WSH" as away team
    const syntheticSource = buildSourceGameWithTeams(
      "WSH", "BOS",
      "2026-04-06T20:10:00Z" // must be within ±30min of DK startEventDate
    );

    // Step 4-5: Feed both into the actual join function
    const joined = joinDraftKingsSportsbookMoneylines({
      sourceGames: [syntheticSource],
      moneylineSlate: parsedSlate.data,
      options: { simulation: { seed: 17, iterations: 250 } }
    });

    expect(joined.ready_games).toBe(1);
    expect(joined.held_games).toBe(0);
    expect(joined.games[0]?.draftkings_sportsbook_moneyline.blocked.is_blocked).toBe(false);
  });

  it("raw DK 'A's' → adapter normalizes to 'ATH' → join against canonical ATH succeeds", () => {
    const rawPayload = buildDkPayloadWithShortNames("A's", "SEA");
    const parsedSlate = parseDraftKingsSportsbookMlbMoneylineSlate({
      fetchedAt: asISOTimestamp("2026-04-06T17:00:00Z"),
      payload: rawPayload
    });
    expect(parsedSlate.success).toBe(true);
    if (!parsedSlate.success) throw new Error(parsedSlate.error);

    expect(parsedSlate.data.entries[0]?.away_team_abbreviation).toBe("ATH");

    const syntheticSource = buildSourceGameWithTeams(
      "ATH", "SEA",
      "2026-04-06T20:10:00Z"
    );

    const joined = joinDraftKingsSportsbookMoneylines({
      sourceGames: [syntheticSource],
      moneylineSlate: parsedSlate.data,
      options: { simulation: { seed: 17, iterations: 250 } }
    });

    expect(joined.ready_games).toBe(1);
    expect(joined.held_games).toBe(0);
    expect(joined.games[0]?.draftkings_sportsbook_moneyline.blocked.is_blocked).toBe(false);
  });

  it("raw DK 'SFG' → adapter normalizes to 'SF' → join against canonical SF succeeds", () => {
    const rawPayload = buildDkPayloadWithShortNames("SFG", "LAD");
    const parsedSlate = parseDraftKingsSportsbookMlbMoneylineSlate({
      fetchedAt: asISOTimestamp("2026-04-06T17:00:00Z"),
      payload: rawPayload
    });
    expect(parsedSlate.success).toBe(true);
    if (!parsedSlate.success) throw new Error(parsedSlate.error);

    expect(parsedSlate.data.entries[0]?.away_team_abbreviation).toBe("SF");

    const syntheticSource = buildSourceGameWithTeams(
      "SF", "LAD",
      "2026-04-06T20:10:00Z"
    );

    const joined = joinDraftKingsSportsbookMoneylines({
      sourceGames: [syntheticSource],
      moneylineSlate: parsedSlate.data,
      options: { simulation: { seed: 17, iterations: 250 } }
    });

    expect(joined.ready_games).toBe(1);
    expect(joined.held_games).toBe(0);
    expect(joined.games[0]?.draftkings_sportsbook_moneyline.blocked.is_blocked).toBe(false);
  });

  it("raw DK 'NY' → adapter normalizes to 'NYY' → join against canonical NYY succeeds", () => {
    // KC@NYY regression: DK sportsbook uses "NY" as the Yankees shortName.
    // The adapter now maps "NY" → "NYY" at parse time.
    const rawPayload = buildDkPayloadWithShortNames("KC", "NY");
    const parsedSlate = parseDraftKingsSportsbookMlbMoneylineSlate({
      fetchedAt: asISOTimestamp("2026-04-19T17:00:00Z"),
      payload: rawPayload
    });
    expect(parsedSlate.success).toBe(true);
    if (!parsedSlate.success) throw new Error(parsedSlate.error);

    // Verify normalization happened at parse time
    expect(parsedSlate.data.entries[0]?.away_team_abbreviation).toBe("KC");
    expect(parsedSlate.data.entries[0]?.home_team_abbreviation).toBe("NYY");

    const syntheticSource = buildSourceGameWithTeams(
      "KC", "NYY",
      "2026-04-06T20:10:00Z"
    );

    const joined = joinDraftKingsSportsbookMoneylines({
      sourceGames: [syntheticSource],
      moneylineSlate: parsedSlate.data,
      options: { simulation: { seed: 17, iterations: 250 } }
    });

    expect(joined.ready_games).toBe(1);
    expect(joined.held_games).toBe(0);
    expect(joined.games[0]?.draftkings_sportsbook_moneyline.blocked.is_blocked).toBe(false);
  });

  it("negative control: truly unrecognized shortName ('XYZZY') still blocks the join", () => {
    // Even with join-level normalization, a shortName that has no known mapping
    // passes through as-is. "XYZZY" ≠ any canonical abbreviation → join fails.
    const syntheticSource = buildSourceGameWithTeams(
      "WSH", "BOS",
      "2026-04-06T20:10:00Z"
    );

    const slateThatBypassesAdapter = makeMoneylineSlate([
      {
        away_team_abbreviation: "XYZZY", // unrecognizable — no mapping exists
        home_team_abbreviation: "BOS",
        start_time: asISOTimestamp("2026-04-06T20:10:00Z")
      }
    ]);

    const joined = joinDraftKingsSportsbookMoneylines({
      sourceGames: [syntheticSource],
      moneylineSlate: slateThatBypassesAdapter,
      options: { simulation: { seed: 17, iterations: 250 } }
    });

    // "XYZZY" cannot be normalized to "WSH" → join fails
    expect(joined.ready_games).toBe(0);
    expect(joined.held_games).toBe(1);
    expect(joined.games[0]?.draftkings_sportsbook_moneyline.blocked.is_blocked).toBe(true);
  });

  it("legacy stored snapshot with 'NY' abbreviation resolves via join-level normalization", () => {
    // KC@NYY 2026-04-19 regression: the Supabase snapshot was stored before the
    // "NY" → "NYY" adapter mapping was added, so the stored entry carries "NY".
    // The join applies normalizeDkTeamAbbreviation defensively, turning "NY" into
    // "NYY" at match time so the legacy snapshot resolves without a re-capture.
    const syntheticSource = buildSourceGameWithTeams(
      "KC", "NYY",
      "2026-04-06T20:10:00Z"
    );

    const legacyStoredSlate = makeMoneylineSlate([
      {
        away_team_abbreviation: "KC",
        home_team_abbreviation: "NY",  // stored before adapter fix
        start_time: asISOTimestamp("2026-04-06T20:10:00Z")
      }
    ]);

    const joined = joinDraftKingsSportsbookMoneylines({
      sourceGames: [syntheticSource],
      moneylineSlate: legacyStoredSlate,
      options: { simulation: { seed: 17, iterations: 250 } }
    });

    expect(joined.ready_games).toBe(1);
    expect(joined.held_games).toBe(0);
    expect(joined.games[0]?.draftkings_sportsbook_moneyline.blocked.is_blocked).toBe(false);
  });

  it("in-progress game (is_live: true) with stored pregame moneyline resolves as ready", () => {
    // Regression: KC@NYY 2026-04-19 board path. After game start the DK live feed
    // rotates the game out, but the Supabase snapshot preserves the pregame odds.
    // The board must accept a stored moneyline for a game already underway —
    // is_live=true in liveScoreState must not cause a held classification.
    const liveSourceGame = {
      ...buildSourceGameWithTeams("KC", "NYY", "2026-04-06T22:05:00Z"),
      liveScoreState: {
        away_score: 0,
        home_score: 0,
        inning_number: 1,
        inning_state: "top" as const,
        is_live: true,
        is_final: false,
        display_state: "Top 1st"
      }
    };

    const storedSlate = makeMoneylineSlate([
      {
        away_team_abbreviation: "KC",
        home_team_abbreviation: "NYY",
        start_time: asISOTimestamp("2026-04-06T22:05:00Z")
      }
    ]);

    const joined = joinDraftKingsSportsbookMoneylines({
      sourceGames: [liveSourceGame],
      moneylineSlate: storedSlate,
      options: { simulation: { seed: 17, iterations: 250 } }
    });

    expect(joined.ready_games).toBe(1);
    expect(joined.held_games).toBe(0);
    expect(joined.games[0]?.draftkings_sportsbook_moneyline.blocked.is_blocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BF-004 test helper: builds a minimal DK-shaped raw payload with controlled
// shortName values so we can prove normalization at the adapter boundary.
// ---------------------------------------------------------------------------

function buildDkPayloadWithShortNames(
  awayShortName: string,
  homeShortName: string
) {
  return {
    sports: [],
    leagues: [],
    events: [
      {
        id: "99900001",
        seoIdentifier: "test-game",
        sportId: "7",
        leagueId: "84240",
        name: `${awayShortName} Team @ ${homeShortName} Team`,
        startEventDate: "2026-04-06T20:10:00.0000000Z",
        participants: [
          {
            id: "home-1",
            name: `${homeShortName} Team`,
            venueRole: "Home",
            type: "Team",
            metadata: {
              shortName: homeShortName,
              startingPitcherPlayerName: "Home Pitcher"
            }
          },
          {
            id: "away-1",
            name: `${awayShortName} Team`,
            venueRole: "Away",
            type: "Team",
            metadata: {
              shortName: awayShortName,
              startingPitcherPlayerName: "Away Pitcher"
            }
          }
        ],
        eventParticipantType: "TwoTeam",
        status: "NOT_STARTED",
        metadata: {},
        sortOrder: 1,
        subscriptionKey: "test"
      }
    ],
    markets: [
      {
        id: "1_99900001",
        eventId: "99900001",
        sportId: "7",
        leagueId: "84240",
        name: "Moneyline",
        subcategoryId: "4519",
        marketType: { id: "1_0", betOfferTypeId: 2, name: "Moneyline" },
        subscriptionKey: "test",
        sortOrder: 1,
        tags: ["Default", "PrimaryMarket"]
      }
    ],
    selections: [
      {
        id: "sel-away",
        marketId: "1_99900001",
        label: `${awayShortName} Team`,
        displayOdds: { american: "+110", decimal: "2.10" },
        trueOdds: 2.1,
        outcomeType: "Away",
        participants: [{ id: "away-1", name: `${awayShortName} Team`, venueRole: "Away" }],
        sortOrder: 1,
        tags: [],
        metadata: {}
      },
      {
        id: "sel-home",
        marketId: "1_99900001",
        label: `${homeShortName} Team`,
        displayOdds: { american: "-130", decimal: "1.77" },
        trueOdds: 1.77,
        outcomeType: "Home",
        participants: [{ id: "home-1", name: `${homeShortName} Team`, venueRole: "Home" }],
        sortOrder: 2,
        tags: [],
        metadata: {}
      }
    ],
    subscriptionPartials: {}
  };
}
