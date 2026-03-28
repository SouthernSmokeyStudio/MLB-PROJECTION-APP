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
}

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
    park_factor_runs: venue.park_factor_runs,
    is_dome: venue.is_dome ?? false,
    is_retractable_roof: venue.is_retractable_roof ?? false
  };
};

const createBlockedPreparedGame = (
  game: CanonicalGame,
  preparedAt: ISOTimestamp,
  reasons: readonly string[]
): PreparedGameInputs => ({
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
  away_team: {
    team_id: game.away.team.team_id,
    team_woba: null,
    team_runs_per_game: null,
    team_k_rate: null,
    team_bb_rate: null,
    team_era: null,
    team_whip: null,
    bullpen_era: null,
    lineup_batters_available: 0,
    lineup_avg_woba: null
  },
  home_team: {
    team_id: game.home.team.team_id,
    team_woba: null,
    team_runs_per_game: null,
    team_k_rate: null,
    team_bb_rate: null,
    team_era: null,
    team_whip: null,
    bullpen_era: null,
    lineup_batters_available: 0,
    lineup_avg_woba: null
  },
  away_starter: null,
  home_starter: null,
  away_batters: [],
  home_batters: [],
  blocked: {
    is_blocked: true,
    blocked_reason: reasons.join("; ")
  },
  has_both_starters: false,
  has_both_lineups: false,
  completeness_score: 0
});

export const prepareGameInputs = (
  game: CanonicalGame,
  data?: Partial<GamePreparationData>
): PreparedGameInputs => {
  const preparedAt = data?.prepared_at ?? asISOTimestamp(new Date().toISOString());
  const reasons: string[] = [];

  if (!data) {
    reasons.push("Missing preparation data");
  }

  if (!data?.away_team) {
    reasons.push("Missing away_team preparation data");
  }

  if (!data?.home_team) {
    reasons.push("Missing home_team preparation data");
  }

  if (!data?.away_starter) {
    reasons.push("Missing away_starter preparation data");
  }

  if (!data?.home_starter) {
    reasons.push("Missing home_starter preparation data");
  }

  if (!data?.away_batters || data.away_batters.length === 0) {
    reasons.push("Missing away_batters preparation data");
  }

  if (!data?.home_batters || data.home_batters.length === 0) {
    reasons.push("Missing home_batters preparation data");
  }

  if (data?.away_team && data.away_team.team_id !== game.away.team.team_id) {
    reasons.push("away_team team_id does not match canonical game");
  }

  if (data?.home_team && data.home_team.team_id !== game.home.team.team_id) {
    reasons.push("home_team team_id does not match canonical game");
  }

  if (
    data?.away_starter &&
    game.away.probable_pitcher &&
    data.away_starter.player_id !== game.away.probable_pitcher.player_id
  ) {
    reasons.push("away_starter player_id does not match canonical probable pitcher");
  }

  if (
    data?.home_starter &&
    game.home.probable_pitcher &&
    data.home_starter.player_id !== game.home.probable_pitcher.player_id
  ) {
    reasons.push("home_starter player_id does not match canonical probable pitcher");
  }

  if (reasons.length > 0) {
    return createBlockedPreparedGame(game, preparedAt, reasons);
  }

  const awayTeam = data!.away_team!;
  const homeTeam = data!.home_team!;
  const awayStarter = data!.away_starter!;
  const homeStarter = data!.home_starter!;
  const awayBatters = data!.away_batters!;
  const homeBatters = data!.home_batters!;
  const hasBothStarters = awayStarter != null && homeStarter != null;
  const hasBothLineups = awayBatters.length > 0 && homeBatters.length > 0;
  const completenessChecks = [true, true, hasBothStarters, hasBothLineups, game.venue !== null, game.weather !== null];
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
      is_blocked: false,
      blocked_reason: null
    },
    has_both_starters: hasBothStarters,
    has_both_lineups: hasBothLineups,
    completeness_score: completenessScore
  };
};
