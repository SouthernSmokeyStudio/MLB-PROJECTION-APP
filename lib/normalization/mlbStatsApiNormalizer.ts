import type { MlbStatsApiScheduleGame } from "@lib/adapters/contracts";
import type {
  CanonicalGame,
  CanonicalTeam,
  CanonicalVenue,
  ProbablePitcher,
  TeamGameContext
} from "@lib/contracts/canonical";
import {
  asGameId,
  asISOTimestamp,
  asPlayerId,
  asTeamId,
  asVenueId,
  err,
  ok,
  type GameStatus,
  type Handedness,
  type Result,
  type WeatherSummary,
  SPORT_ID
} from "@lib/contracts/types";
import {
  createDefaultNormalizationContext,
  type MlbStatsApiGameNormalizer,
  type NormalizationContext
} from "./contracts";

const parseWindField = (
  wind: string | null
): { wind_speed_mph: number | null; wind_direction: string | null } => {
  if (!wind) return { wind_speed_mph: null, wind_direction: null };
  const commaIdx = wind.indexOf(", ");
  if (commaIdx === -1) return { wind_speed_mph: null, wind_direction: null };
  const speedPart = wind.slice(0, commaIdx);
  const direction = wind.slice(commaIdx + 2).trim();
  const speedMatch = /^(\d+(?:\.\d+)?)\s*mph$/i.exec(speedPart);
  return {
    wind_speed_mph: speedMatch && speedMatch[1] != null ? parseFloat(speedMatch[1]) : null,
    wind_direction: direction === "None" || direction === "" ? null : direction
  };
};

const buildWeather = (
  apiWeather: import("@lib/adapters/contracts").MlbStatsApiWeather | null
): WeatherSummary | null => {
  if (!apiWeather) return null;
  // MLB Stats API returns weather: {} for scheduled/pregame games.
  // An empty object passes isRecord() but carries no usable data.
  // Return null so canonicalGame.weather is cleanly null for those games.
  if (apiWeather.condition === null && apiWeather.temp === null && apiWeather.wind === null) {
    return null;
  }
  const temperatureF = apiWeather.temp != null ? parseFloat(apiWeather.temp) : null;
  const { wind_speed_mph, wind_direction } = parseWindField(apiWeather.wind);
  return {
    temperature_f: temperatureF != null && Number.isFinite(temperatureF) ? temperatureF : null,
    wind_speed_mph,
    wind_direction,
    precipitation_chance: null,
    conditions: apiWeather.condition,
    dome_closed: apiWeather.condition === "Roof Closed" ? true : null
  };
};

const TEAM_METADATA: Record<number, Omit<CanonicalTeam, "team_id" | "sport_id"> & { team_id_raw: string }> = {
  108: {
    team_id_raw: "laa",
    abbreviation: "LAA",
    full_name: "Los Angeles Angels",
    league: "AL",
    division: "West"
  },
  109: {
    team_id_raw: "ari",
    abbreviation: "ARI",
    full_name: "Arizona Diamondbacks",
    league: "NL",
    division: "West"
  },
  110: {
    team_id_raw: "bal",
    abbreviation: "BAL",
    full_name: "Baltimore Orioles",
    league: "AL",
    division: "East"
  },
  111: {
    team_id_raw: "bos",
    abbreviation: "BOS",
    full_name: "Boston Red Sox",
    league: "AL",
    division: "East"
  },
  112: {
    team_id_raw: "chc",
    abbreviation: "CHC",
    full_name: "Chicago Cubs",
    league: "NL",
    division: "Central"
  },
  113: {
    team_id_raw: "cin",
    abbreviation: "CIN",
    full_name: "Cincinnati Reds",
    league: "NL",
    division: "Central"
  },
  114: {
    team_id_raw: "cle",
    abbreviation: "CLE",
    full_name: "Cleveland Guardians",
    league: "AL",
    division: "Central"
  },
  115: {
    team_id_raw: "col",
    abbreviation: "COL",
    full_name: "Colorado Rockies",
    league: "NL",
    division: "West"
  },
  116: {
    team_id_raw: "det",
    abbreviation: "DET",
    full_name: "Detroit Tigers",
    league: "AL",
    division: "Central"
  },
  117: {
    team_id_raw: "hou",
    abbreviation: "HOU",
    full_name: "Houston Astros",
    league: "AL",
    division: "West"
  },
  118: {
    team_id_raw: "kc",
    abbreviation: "KC",
    full_name: "Kansas City Royals",
    league: "AL",
    division: "Central"
  },
  119: {
    team_id_raw: "lad",
    abbreviation: "LAD",
    full_name: "Los Angeles Dodgers",
    league: "NL",
    division: "West"
  },
  120: {
    team_id_raw: "wsh",
    abbreviation: "WSH",
    full_name: "Washington Nationals",
    league: "NL",
    division: "East"
  },
  121: {
    team_id_raw: "nym",
    abbreviation: "NYM",
    full_name: "New York Mets",
    league: "NL",
    division: "East"
  },
  133: {
    team_id_raw: "ath",
    abbreviation: "ATH",
    full_name: "Athletics",
    league: "AL",
    division: "West"
  },
  134: {
    team_id_raw: "pit",
    abbreviation: "PIT",
    full_name: "Pittsburgh Pirates",
    league: "NL",
    division: "Central"
  },
  135: {
    team_id_raw: "sd",
    abbreviation: "SD",
    full_name: "San Diego Padres",
    league: "NL",
    division: "West"
  },
  136: {
    team_id_raw: "sea",
    abbreviation: "SEA",
    full_name: "Seattle Mariners",
    league: "AL",
    division: "West"
  },
  137: {
    team_id_raw: "sf",
    abbreviation: "SF",
    full_name: "San Francisco Giants",
    league: "NL",
    division: "West"
  },
  138: {
    team_id_raw: "stl",
    abbreviation: "STL",
    full_name: "St. Louis Cardinals",
    league: "NL",
    division: "Central"
  },
  139: {
    team_id_raw: "tb",
    abbreviation: "TB",
    full_name: "Tampa Bay Rays",
    league: "AL",
    division: "East"
  },
  140: {
    team_id_raw: "tex",
    abbreviation: "TEX",
    full_name: "Texas Rangers",
    league: "AL",
    division: "West"
  },
  141: {
    team_id_raw: "tor",
    abbreviation: "TOR",
    full_name: "Toronto Blue Jays",
    league: "AL",
    division: "East"
  },
  142: {
    team_id_raw: "min",
    abbreviation: "MIN",
    full_name: "Minnesota Twins",
    league: "AL",
    division: "Central"
  },
  143: {
    team_id_raw: "phi",
    abbreviation: "PHI",
    full_name: "Philadelphia Phillies",
    league: "NL",
    division: "East"
  },
  144: {
    team_id_raw: "atl",
    abbreviation: "ATL",
    full_name: "Atlanta Braves",
    league: "NL",
    division: "East"
  },
  145: {
    team_id_raw: "cws",
    abbreviation: "CWS",
    full_name: "Chicago White Sox",
    league: "AL",
    division: "Central"
  },
  146: {
    team_id_raw: "mia",
    abbreviation: "MIA",
    full_name: "Miami Marlins",
    league: "NL",
    division: "East"
  },
  147: {
    team_id_raw: "nyy",
    abbreviation: "NYY",
    full_name: "New York Yankees",
    league: "AL",
    division: "East"
  },
  158: {
    team_id_raw: "mil",
    abbreviation: "MIL",
    full_name: "Milwaukee Brewers",
    league: "NL",
    division: "Central"
  }
};

// Park run factors: 3-year average (2022-2024). Decimal format; 1.0 = neutral.
// Source: Baseball Reference park factors, runs-based. Coors Field is the
// single largest outlier (~5280 ft elevation, thin air). All others are
// meaningful but smaller. Update annually — park factors drift ~0.01/year.
// Dome/retractable-roof flags: true dome = weather factor always 1.0;
// retractable = roof-open/closed is game-day dependent (tracked via API).
// Sutter Health Park (ATH): limited MLB data; conservative neutral estimate.
const VENUE_METADATA: Record<number, CanonicalVenue> = {
  // ── American League East ─────────────────────────────────────────────────
  2: {
    venue_id: asVenueId("oriole-park-at-camden-yards"),
    name: "Oriole Park at Camden Yards",
    city: "Baltimore",
    state: "MD",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    park_factor_runs: 1.01
  },
  3: {
    venue_id: asVenueId("fenway-park"),
    name: "Fenway Park",
    city: "Boston",
    state: "MA",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    park_factor_runs: 1.04
  },
  3313: {
    venue_id: asVenueId("yankee-stadium"),
    name: "Yankee Stadium",
    city: "Bronx",
    state: "NY",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    park_factor_runs: 1.03
  },
  3289: {
    venue_id: asVenueId("citi-field"),
    name: "Citi Field",
    city: "Queens",
    state: "NY",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    park_factor_runs: 0.96
  },
  14: {
    venue_id: asVenueId("rogers-centre"),
    name: "Rogers Centre",
    city: "Toronto",
    state: null,
    country: "Canada",
    is_dome: true,
    is_retractable_roof: true,
    park_factor_runs: 1.02
  },
  12: {
    venue_id: asVenueId("tropicana-field"),
    name: "Tropicana Field",
    city: "St. Petersburg",
    state: "FL",
    country: "USA",
    is_dome: true,
    is_retractable_roof: false,
    park_factor_runs: 0.95
  },
  // ── American League Central ──────────────────────────────────────────────
  5: {
    venue_id: asVenueId("progressive-field"),
    name: "Progressive Field",
    city: "Cleveland",
    state: "OH",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    park_factor_runs: 0.96
  },
  2394: {
    venue_id: asVenueId("comerica-park"),
    name: "Comerica Park",
    city: "Detroit",
    state: "MI",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    park_factor_runs: 0.96
  },
  7: {
    venue_id: asVenueId("kauffman-stadium"),
    name: "Kauffman Stadium",
    city: "Kansas City",
    state: "MO",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    park_factor_runs: 0.97
  },
  32: {
    venue_id: asVenueId("american-family-field"),
    name: "American Family Field",
    city: "Milwaukee",
    state: "WI",
    country: "USA",
    is_dome: false,
    is_retractable_roof: true,
    park_factor_runs: 1.01
  },
  3312: {
    venue_id: asVenueId("target-field"),
    name: "Target Field",
    city: "Minneapolis",
    state: "MN",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    park_factor_runs: 0.97
  },
  4: {
    venue_id: asVenueId("rate-field"),
    name: "Rate Field",
    city: "Chicago",
    state: "IL",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    park_factor_runs: 1.00
  },
  // ── American League West ─────────────────────────────────────────────────
  1: {
    venue_id: asVenueId("angel-stadium"),
    name: "Angel Stadium",
    city: "Anaheim",
    state: "CA",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    park_factor_runs: 1.00
  },
  2392: {
    venue_id: asVenueId("daikin-park"),
    name: "Daikin Park",
    city: "Houston",
    state: "TX",
    country: "USA",
    is_dome: false,
    is_retractable_roof: true,
    park_factor_runs: 1.01
  },
  680: {
    venue_id: asVenueId("t-mobile-park"),
    name: "T-Mobile Park",
    city: "Seattle",
    state: "WA",
    country: "USA",
    is_dome: false,
    is_retractable_roof: true,
    park_factor_runs: 0.94
  },
  5325: {
    venue_id: asVenueId("globe-life-field"),
    name: "Globe Life Field",
    city: "Arlington",
    state: "TX",
    country: "USA",
    is_dome: false,
    is_retractable_roof: true,
    park_factor_runs: 1.00
  },
  2529: {
    venue_id: asVenueId("sutter-health-park"),
    name: "Sutter Health Park",
    city: "Sacramento",
    state: "CA",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    // Limited MLB data (Athletics relocated to Sacramento in 2025).
    // Conservative neutral estimate; revisit after one full season.
    park_factor_runs: 0.97
  },
  // ── National League East ─────────────────────────────────────────────────
  4705: {
    venue_id: asVenueId("truist-park"),
    name: "Truist Park",
    city: "Cumberland",
    state: "GA",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    park_factor_runs: 1.02
  },
  4169: {
    venue_id: asVenueId("loandepot-park"),
    name: "loanDepot park",
    city: "Miami",
    state: "FL",
    country: "USA",
    is_dome: false,
    is_retractable_roof: true,
    park_factor_runs: 0.93
  },
  3309: {
    venue_id: asVenueId("nationals-park"),
    name: "Nationals Park",
    city: "Washington",
    state: "DC",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    park_factor_runs: 0.98
  },
  2681: {
    venue_id: asVenueId("citizens-bank-park"),
    name: "Citizens Bank Park",
    city: "Philadelphia",
    state: "PA",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    park_factor_runs: 1.04
  },
  // ── National League Central ──────────────────────────────────────────────
  17: {
    venue_id: asVenueId("wrigley-field"),
    name: "Wrigley Field",
    city: "Chicago",
    state: "IL",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    park_factor_runs: 1.02
  },
  2602: {
    venue_id: asVenueId("great-american-ball-park"),
    name: "Great American Ball Park",
    city: "Cincinnati",
    state: "OH",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    park_factor_runs: 1.05
  },
  2889: {
    venue_id: asVenueId("busch-stadium"),
    name: "Busch Stadium",
    city: "St. Louis",
    state: "MO",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    park_factor_runs: 0.96
  },
  31: {
    venue_id: asVenueId("pnc-park"),
    name: "PNC Park",
    city: "Pittsburgh",
    state: "PA",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    park_factor_runs: 0.95
  },
  // ── National League West ─────────────────────────────────────────────────
  19: {
    venue_id: asVenueId("coors-field"),
    name: "Coors Field",
    city: "Denver",
    state: "CO",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    // Highest park factor in MLB. ~5280 ft elevation; thin air, long ball,
    // runs score at a rate ~17% above neutral. Not a rounding error.
    park_factor_runs: 1.17
  },
  15: {
    venue_id: asVenueId("chase-field"),
    name: "Chase Field",
    city: "Phoenix",
    state: "AZ",
    country: "USA",
    is_dome: false,
    is_retractable_roof: true,
    park_factor_runs: 1.03
  },
  22: {
    venue_id: asVenueId("dodger-stadium"),
    name: "Dodger Stadium",
    city: "Los Angeles",
    state: "CA",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    park_factor_runs: 0.97
  },
  2395: {
    venue_id: asVenueId("oracle-park"),
    name: "Oracle Park",
    city: "San Francisco",
    state: "CA",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    park_factor_runs: 0.93
  },
  2680: {
    venue_id: asVenueId("petco-park"),
    name: "Petco Park",
    city: "San Diego",
    state: "CA",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    park_factor_runs: 0.94
  }
};

const PITCHER_HANDEDNESS: Record<number, Handedness> = {
  519242: "L",
  543037: "R"
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const mapStatus = (codedGameState: string | null, detailedState: string | null): GameStatus => {
  const normalizedDetailedState = detailedState?.toLowerCase() ?? null;

  if (codedGameState === "S" || normalizedDetailedState === "scheduled") {
    return "scheduled";
  }

  if (codedGameState === "P") {
    return "pregame";
  }

  if (codedGameState === "I") {
    return "in_progress";
  }

  if (codedGameState === "F") {
    return "final";
  }

  if (normalizedDetailedState === "postponed") {
    return "postponed";
  }

  if (normalizedDetailedState === "cancelled") {
    return "cancelled";
  }

  if (normalizedDetailedState === "delayed") {
    return "delayed";
  }

  if (normalizedDetailedState === "suspended") {
    return "suspended";
  }

  return "unknown";
};

const buildCanonicalTeam = (teamId: number): Result<CanonicalTeam, string> => {
  const metadata = TEAM_METADATA[teamId];

  if (!metadata) {
    return err(`Unsupported MLB team id in fixture-backed normalizer: ${teamId}`);
  }

  return ok({
    team_id: asTeamId(metadata.team_id_raw),
    sport_id: SPORT_ID,
    abbreviation: metadata.abbreviation,
    full_name: metadata.full_name,
    league: metadata.league,
    division: metadata.division
  });
};

const buildProbablePitcher = (
  probablePitcher: MlbStatsApiScheduleGame["teams"]["away"]["probablePitcher"]
): ProbablePitcher | null => {
  if (!probablePitcher) {
    return null;
  }

  const rawPlayerId =
    probablePitcher.fullName && probablePitcher.fullName.trim().length > 0
      ? slugify(probablePitcher.fullName)
      : String(probablePitcher.id);

  return {
    player_id: asPlayerId(rawPlayerId),
    mlb_stats_api_id: String(probablePitcher.id),
    starting_status: "probable",
    handedness: PITCHER_HANDEDNESS[probablePitcher.id] ?? "unknown"
  };
};

const buildTeamGameContext = (
  side: MlbStatsApiScheduleGame["teams"]["away"]
): Result<TeamGameContext, string> => {
  const team = buildCanonicalTeam(side.team.id);
  if (!team.success) {
    return team;
  }

  return ok({
    team: team.data,
    probable_pitcher: buildProbablePitcher(side.probablePitcher),
    lineup: null,
    lineup_confirmed: false
  });
};

const buildVenue = (venue: MlbStatsApiScheduleGame["venue"]): CanonicalVenue | null => {
  if (!venue) {
    return null;
  }

  return (
    VENUE_METADATA[venue.id] ?? {
      venue_id: asVenueId(`mlb-venue-${venue.id}-${slugify(venue.name)}`),
      name: venue.name,
      city: null,
      state: null,
      country: "USA",
      is_dome: null,
      is_retractable_roof: null,
      park_factor_runs: null
    }
  );
};

export const normalizeMlbStatsApiGame = (
  raw: MlbStatsApiScheduleGame,
  context?: Partial<NormalizationContext>
): Result<CanonicalGame, string> => {
  const away = buildTeamGameContext(raw.teams.away);
  if (!away.success) {
    return away;
  }

  const home = buildTeamGameContext(raw.teams.home);
  if (!home.success) {
    return home;
  }

  const awayAbbreviation = away.data.team.abbreviation.toLowerCase();
  const homeAbbreviation = home.data.team.abbreviation.toLowerCase();
  // Use officialDate (Eastern/local calendar date) for the game_id so that
  // late West Coast games crossing the UTC midnight boundary are keyed on the
  // same date that MLB, DraftKings, and Rotowire use.  scheduled_start still
  // carries the precise UTC timestamp from gameDate.
  const gameIdDate = raw.officialDate;
  const rawPayloadRef = context?.raw_payload_ref ?? `raw-mlb-${raw.gamePk}`;
  const resolvedContext = {
    ...createDefaultNormalizationContext(rawPayloadRef),
    ...context,
    raw_payload_ref: rawPayloadRef
  };

  return ok({
    game_id: asGameId(`mlb-${gameIdDate}-${awayAbbreviation}-${homeAbbreviation}`),
    sport_id: SPORT_ID,
    scheduled_start: asISOTimestamp(raw.gameDate),
    status: mapStatus(raw.status.codedGameState, raw.status.detailedState),
    away: away.data,
    home: home.data,
    venue: buildVenue(raw.venue),
    weather: buildWeather(raw.weather),
    sources: [
      {
        provider: "mlb-statsapi",
        endpoint: resolvedContext.endpoint,
        fetched_at: resolvedContext.fetched_at,
        raw_payload_hash: resolvedContext.raw_payload_hash
      }
    ],
    freshness: {
      is_stale: false,
      stale_reason: null,
      last_synced: resolvedContext.fetched_at
    },
    raw_payload_refs: [resolvedContext.raw_payload_ref]
  });
};

export const mlbStatsApiNormalizer: MlbStatsApiGameNormalizer = {
  normalizeGame: normalizeMlbStatsApiGame
};
