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
  111: {
    team_id_raw: "bos",
    abbreviation: "BOS",
    full_name: "Boston Red Sox",
    league: "AL",
    division: "East"
  },
  147: {
    team_id_raw: "nyy",
    abbreviation: "NYY",
    full_name: "New York Yankees",
    league: "AL",
    division: "East"
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

  return VENUE_METADATA[venue.id] ?? null;
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
  const gameDate = raw.gameDate.slice(0, 10);
  const rawPayloadRef = context?.raw_payload_ref ?? `raw-mlb-${raw.gamePk}`;
  const resolvedContext = {
    ...createDefaultNormalizationContext(rawPayloadRef),
    ...context,
    raw_payload_ref: rawPayloadRef
  };

  return ok({
    game_id: asGameId(`mlb-${gameDate}-${awayAbbreviation}-${homeAbbreviation}`),
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
