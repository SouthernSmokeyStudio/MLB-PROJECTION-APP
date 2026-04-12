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
  SPORT_ID
} from "@lib/contracts/types";
import {
  createDefaultNormalizationContext,
  type MlbStatsApiGameNormalizer,
  type NormalizationContext
} from "./contracts";

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

const VENUE_METADATA: Record<number, CanonicalVenue> = {
  3: {
    venue_id: asVenueId("fenway-park"),
    name: "Fenway Park",
    city: "Boston",
    state: "MA",
    country: "USA",
    is_dome: false,
    is_retractable_roof: false,
    park_factor_runs: 1.04
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
    weather: null,
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
