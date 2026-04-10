import type { CanonicalGame, CanonicalVenue } from "@lib/contracts/canonical";
import type {
  PreparedBatterInputs,
  PreparedGameInputs,
  PreparedPitcherInputs,
  PreparedTeamInputs
} from "@lib/contracts/prepared";
import { asISOTimestamp, type ISOTimestamp } from "@lib/contracts/types";

export interface GamePreparationData {
  readonly prepared_at: ISOTimestamp;
  readonly away_team: PreparedTeamInputs;
  readonly home_team: PreparedTeamInputs;
  readonly away_starter: PreparedPitcherInputs | null;
  readonly home_starter: PreparedPitcherInputs | null;
  readonly away_batters: readonly PreparedBatterInputs[];
  readonly home_batters: readonly PreparedBatterInputs[];
  readonly away_team_season_hitting?: unknown;
  readonly home_team_season_hitting?: unknown;
  readonly away_team_relief_pitching?: unknown;
  readonly home_team_relief_pitching?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readNullableRecord = (value: unknown): Record<string, unknown> | null => (isRecord(value) ? value : null);
const readNullableArray = (value: unknown): unknown[] | null => (Array.isArray(value) ? value : null);

const parseNumericString = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (
    normalized.length === 0 ||
    normalized === "-" ||
    normalized === "--" ||
    normalized === "-.--" ||
    normalized.toUpperCase() === "N/A"
  ) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const readFirstTeamStat = (payload: unknown): Record<string, unknown> | null => {
  const payloadRecord = readNullableRecord(payload);
  const stats = readNullableArray(payloadRecord?.stats);
  const firstStatsBlock = stats && stats.length > 0 ? readNullableRecord(stats[0]) : null;
  const splits = readNullableArray(firstStatsBlock?.splits);
  const firstSplit = splits && splits.length > 0 ? readNullableRecord(splits[0]) : null;

  return readNullableRecord(firstSplit?.stat);
};

const readReliefPitchingStat = (payload: unknown): Record<string, unknown> | null => {
  const payloadRecord = readNullableRecord(payload);
  const stats = readNullableArray(payloadRecord?.stats);
  const firstStatsBlock = stats && stats.length > 0 ? readNullableRecord(stats[0]) : null;
  const splits = readNullableArray(firstStatsBlock?.splits);

  if (!splits) {
    return null;
  }

  for (const split of splits) {
    const splitRecord = readNullableRecord(split);
    const splitMetadata = readNullableRecord(splitRecord?.split);

    if (splitMetadata?.code === "rp") {
      return readNullableRecord(splitRecord?.stat);
    }
  }

  return null;
};

const normalizeWindDirection = (windDirection: string | null): "in" | "out" | "cross" | "calm" | null => {
  if (windDirection === null) {
    return null;
  }

  const normalized = windDirection.toLowerCase();

  if (normalized.includes("calm")) {
    return "calm";
  }

  if (normalized.includes("out")) {
    return "out";
  }

  if (normalized.includes("in")) {
    return "in";
  }

  if (normalized.includes("cross")) {
    return "cross";
  }

  return null;
};

const mapVenue = (venue: CanonicalVenue | null): PreparedGameInputs["venue"] => {
  if (!venue) {
    return null;
  }

  return {
    // Provisional runtime fallback only: neutral 1.0 is used when a canonical
    // venue exists but park_factor_runs is not yet sourced. This is not final
    // venue or park-factor modeling.
    park_factor_runs: venue.park_factor_runs ?? 1.0,
    is_dome: venue.is_dome ?? false,
    is_retractable_roof: venue.is_retractable_roof ?? false
  };
};

const buildFallbackTeamInputs = (team: CanonicalGame["away"]["team"]): PreparedTeamInputs => ({
  team_id: team.team_id,
  team_woba: null,
  team_runs_per_game: null,
  team_k_rate: null,
  team_bb_rate: null,
  team_era: null,
  team_whip: null,
  bullpen_era: null,
  lineup_batters_available: 0,
  lineup_avg_woba: null
});

const enrichTeamInputs = (
  team: PreparedTeamInputs,
  seasonHittingPayload?: unknown,
  reliefPitchingPayload?: unknown
): PreparedTeamInputs => {
  const seasonHittingStat = readFirstTeamStat(seasonHittingPayload);
  const reliefPitchingStat = readReliefPitchingStat(reliefPitchingPayload);
  const runs = parseNumericString(seasonHittingStat?.runs);
  const gamesPlayed = parseNumericString(seasonHittingStat?.gamesPlayed);
  const teamRunsPerGame =
    runs === null || gamesPlayed === null || gamesPlayed <= 0 ? null : runs / gamesPlayed;

  return {
    ...team,
    team_runs_per_game: teamRunsPerGame,
    // Provisional runtime offense proxy only: MLB Stats API team OBP is carried
    // in team_woba temporarily because true team wOBA is not yet sourced.
    // This is not final model math.
    team_woba: parseNumericString(seasonHittingStat?.obp),
    bullpen_era: parseNumericString(reliefPitchingStat?.era)
  };
};

const buildFallbackPitcherInputs = (
  probablePitcher: CanonicalGame["away"]["probable_pitcher"],
  teamId: PreparedTeamInputs["team_id"]
): PreparedPitcherInputs | null => {
  if (!probablePitcher) {
    return null;
  }

  return {
    player_id: probablePitcher.player_id,
    mlb_stats_api_id: probablePitcher.mlb_stats_api_id,
    team_id: teamId,
    handedness: probablePitcher.handedness,
    season_ip: null,
    season_era: null,
    season_whip: null,
    season_k_per_9: null,
    season_bb_per_9: null,
    season_hr_per_9: null,
    recent_starts_n: null,
    recent_era: null,
    recent_k_per_9: null,
    recent_ip_per_start: null,
    vs_lhb_era: null,
    vs_rhb_era: null,
    days_rest: null,
    last_start_pitches: null
  };
};

const createPreparedGame = (
  game: CanonicalGame,
  preparedAt: ISOTimestamp,
  awayTeam: PreparedTeamInputs,
  homeTeam: PreparedTeamInputs,
  awayStarter: PreparedPitcherInputs | null,
  homeStarter: PreparedPitcherInputs | null,
  awayBatters: readonly PreparedBatterInputs[],
  homeBatters: readonly PreparedBatterInputs[],
  reasons: readonly string[],
  teamLevelReady: boolean
): PreparedGameInputs => {
  const hasBothStarters = awayStarter != null && homeStarter != null;
  const hasBothLineups = awayBatters.length > 0 && homeBatters.length > 0;
  const completenessChecks = [
    awayTeam.team_id === game.away.team.team_id,
    homeTeam.team_id === game.home.team.team_id,
    hasBothStarters,
    hasBothLineups,
    game.venue !== null,
    game.weather !== null
  ];
  const completenessScore = completenessChecks.filter(Boolean).length / completenessChecks.length;

  return {
    game_id: game.game_id,
    sport_id: game.sport_id,
    scheduled_start: game.scheduled_start,
    prepared_at: preparedAt,
    venue: mapVenue(game.venue),
    weather: game.weather
      ? {
          temperature_f: game.weather.temperature_f,
          wind_speed_mph: game.weather.wind_speed_mph,
          wind_direction_normalized: normalizeWindDirection(game.weather.wind_direction),
          is_enclosed: game.venue?.is_dome === true || game.weather.dome_closed === true
        }
      : null,
    away_team: awayTeam,
    home_team: homeTeam,
    away_starter: awayStarter,
    home_starter: homeStarter,
    away_batters: awayBatters,
    home_batters: homeBatters,
    blocked: {
      is_blocked: reasons.length > 0,
      blocked_reason: reasons.length > 0 ? reasons.join("; ") : null
    },
    team_level_ready: teamLevelReady,
    has_both_starters: hasBothStarters,
    has_both_lineups: hasBothLineups,
    completeness_score: completenessScore
  };
};

export const prepareGameInputs = (
  game: CanonicalGame,
  data?: Partial<GamePreparationData>
): PreparedGameInputs => {
  const preparedAt = data?.prepared_at ?? asISOTimestamp(new Date().toISOString());
  const reasons: string[] = [];
  const awayTeam = enrichTeamInputs(
    data?.away_team ?? buildFallbackTeamInputs(game.away.team),
    data?.away_team_season_hitting,
    data?.away_team_relief_pitching
  );
  const homeTeam = enrichTeamInputs(
    data?.home_team ?? buildFallbackTeamInputs(game.home.team),
    data?.home_team_season_hitting,
    data?.home_team_relief_pitching
  );
  const awayStarter = data?.away_starter ?? buildFallbackPitcherInputs(game.away.probable_pitcher, awayTeam.team_id);
  const homeStarter = data?.home_starter ?? buildFallbackPitcherInputs(game.home.probable_pitcher, homeTeam.team_id);
  const awayBatters = data?.away_batters ?? [];
  const homeBatters = data?.home_batters ?? [];

  if (awayBatters.length === 0) {
    reasons.push("Missing away_batters preparation data");
  }

  if (homeBatters.length === 0) {
    reasons.push("Missing home_batters preparation data");
  }

  if (awayTeam.team_id !== game.away.team.team_id) {
    reasons.push("away_team team_id does not match canonical game");
  }

  if (homeTeam.team_id !== game.home.team.team_id) {
    reasons.push("home_team team_id does not match canonical game");
  }

  if (!awayStarter) {
    reasons.push("Missing away_starter preparation data");
  }

  if (!homeStarter) {
    reasons.push("Missing home_starter preparation data");
  }

  if (
    awayStarter &&
    game.away.probable_pitcher &&
    awayStarter.player_id !== game.away.probable_pitcher.player_id
  ) {
    reasons.push("away_starter player_id does not match canonical probable pitcher");
  }

  if (
    homeStarter &&
    game.home.probable_pitcher &&
    homeStarter.player_id !== game.home.probable_pitcher.player_id
  ) {
    reasons.push("home_starter player_id does not match canonical probable pitcher");
  }

  // team_level_ready mirrors projectTeamRuns's own requirements (starters,
  // team aggregate stats, venue) without referencing batter arrays.  mapVenue
  // already falls back park_factor_runs to 1.0 when the canonical venue exists
  // but lacks a sourced park factor, so game.venue !== null is sufficient.
  const teamLevelReady =
    awayStarter !== null &&
    homeStarter !== null &&
    awayStarter.season_era !== null &&
    homeStarter.season_era !== null &&
    awayTeam.team_runs_per_game !== null &&
    awayTeam.team_woba !== null &&
    homeTeam.team_runs_per_game !== null &&
    homeTeam.team_woba !== null &&
    awayTeam.bullpen_era !== null &&
    homeTeam.bullpen_era !== null &&
    game.venue !== null;

  return createPreparedGame(game, preparedAt, awayTeam, homeTeam, awayStarter, homeStarter, awayBatters, homeBatters, reasons, teamLevelReady);
};
