import type { MlbStatsApiScheduleGame } from "@lib/adapters/contracts";
import type { CanonicalGame } from "@lib/contracts/canonical";
import type { PreparedGameInputs } from "@lib/contracts/prepared";
import type {
  ScheduleBoardCounts,
  ScheduleBoardGame,
  ScheduleBoardPayload,
  ScheduleBoardPitcher,
  ScheduleBoardWeather
} from "@lib/contracts/schedule-board";
import { asISOTimestamp } from "@lib/contracts/types";
import { buildGameCard, type BuildGameCardOptions } from "./buildGameCard";
import { buildPlayerCards } from "./buildPlayerCard";
import { checkProjectionReconciliation } from "./checkProjectionReconciliation";

export interface ScheduleBoardSourceGame {
  readonly parsedGame: MlbStatsApiScheduleGame;
  readonly canonicalGame: CanonicalGame;
  readonly preparedGame: PreparedGameInputs;
  readonly playerIdentities: Readonly<Record<string, { full_name: string | null }>>;
}

export interface BuildScheduleBoardOptions {
  readonly source: string;
  readonly date: string;
  readonly counts: ScheduleBoardCounts;
  readonly note?: string | null;
  readonly generated_at?: string;
  readonly simulation?: BuildGameCardOptions["simulation"];
}

const buildPitcher = (
  parsedPitcher: MlbStatsApiScheduleGame["teams"]["away"]["probablePitcher"],
  canonicalPitcher: CanonicalGame["away"]["probable_pitcher"],
  playerIdentities: ScheduleBoardSourceGame["playerIdentities"]
): ScheduleBoardPitcher | null => {
  if (!parsedPitcher && !canonicalPitcher) {
    return null;
  }

  // Prefer the name from the identity map (covers projected/inferred starters).
  // Fall back to the raw MLB Stats API fullName (official source).
  const player_id = canonicalPitcher?.player_id ?? null;
  const full_name =
    (player_id !== null ? playerIdentities[player_id]?.full_name : null) ??
    parsedPitcher?.fullName ??
    null;

  return {
    player_id,
    full_name,
    handedness: canonicalPitcher?.handedness ?? "unknown",
    starting_status: canonicalPitcher?.starting_status ?? "unknown"
  };
};

const buildScheduleBoardWeather = (
  weather: CanonicalGame["weather"]
): ScheduleBoardWeather | null => {
  if (weather === null) return null;
  return {
    temperature_f: weather.temperature_f,
    wind_speed_mph: weather.wind_speed_mph,
    wind_direction: weather.wind_direction,
    conditions: weather.conditions,
    precipitation_chance: weather.precipitation_chance,
    dome_closed: weather.dome_closed
  };
};

const buildScheduleBoardGame = (
  sourceGame: ScheduleBoardSourceGame,
  options: Pick<BuildScheduleBoardOptions, "simulation">
): ScheduleBoardGame => {
  const gameCard = buildGameCard(sourceGame.preparedGame, {
    ...(options.simulation ? { simulation: options.simulation } : {})
  });
  const playerCards = buildPlayerCards(sourceGame.preparedGame, {
    ...(options.simulation ? { simulation: options.simulation } : {})
  });
  const reconciliation = checkProjectionReconciliation({
    game: gameCard,
    players: playerCards.players
  });
  const playerProjectionStatus =
    !gameCard.blocked.is_blocked && reconciliation.passed ? "ready" : "held";

  return {
    game_id: sourceGame.canonicalGame.game_id,
    scheduled_start: sourceGame.canonicalGame.scheduled_start,
    status: sourceGame.canonicalGame.status,
    venue_name: sourceGame.canonicalGame.venue?.name ?? null,
    away_team: {
      team_id: sourceGame.canonicalGame.away.team.team_id,
      abbreviation: sourceGame.canonicalGame.away.team.abbreviation,
      full_name: sourceGame.canonicalGame.away.team.full_name,
      probable_pitcher: buildPitcher(
        sourceGame.parsedGame.teams.away.probablePitcher,
        sourceGame.canonicalGame.away.probable_pitcher,
        sourceGame.playerIdentities
      ),
      lineup_batters_available: sourceGame.preparedGame.away_team.lineup_batters_available
    },
    home_team: {
      team_id: sourceGame.canonicalGame.home.team.team_id,
      abbreviation: sourceGame.canonicalGame.home.team.abbreviation,
      full_name: sourceGame.canonicalGame.home.team.full_name,
      probable_pitcher: buildPitcher(
        sourceGame.parsedGame.teams.home.probablePitcher,
        sourceGame.canonicalGame.home.probable_pitcher,
        sourceGame.playerIdentities
      ),
      lineup_batters_available: sourceGame.preparedGame.home_team.lineup_batters_available
    },
    has_both_starters: sourceGame.preparedGame.has_both_starters,
    has_both_lineups: sourceGame.preparedGame.has_both_lineups,
    completeness_score: sourceGame.preparedGame.completeness_score,
    player_projection_status: playerProjectionStatus,
    projection: {
      blocked: gameCard.blocked,
      projected_away_runs: gameCard.deterministic.projected_away_runs,
      projected_home_runs: gameCard.deterministic.projected_home_runs,
      projected_total: gameCard.deterministic.projected_total,
      away_win_probability: gameCard.simulation?.away_win_probability ?? null,
      home_win_probability: gameCard.simulation?.home_win_probability ?? null,
      average_total_runs: gameCard.simulation?.average_total_runs ?? null
    },
    weather: buildScheduleBoardWeather(sourceGame.canonicalGame.weather ?? null)
  };
};

export const buildScheduleBoard = (
  sourceGames: readonly ScheduleBoardSourceGame[],
  options: BuildScheduleBoardOptions
): ScheduleBoardPayload => {
  const games = sourceGames.map((sourceGame) =>
    buildScheduleBoardGame(sourceGame, options)
  );

  return {
    source: options.source,
    mode: "schedule-board-v1",
    date: options.date,
    generated_at: asISOTimestamp(
      options.generated_at ?? new Date().toISOString()
    ),
    summary: {
      total_games: games.length,
      projection_ready_games: games.filter(
        (game) => !game.projection.blocked.is_blocked
      ).length,
      games_ready_for_player_projections: games.filter(
        (game) => game.player_projection_status === "ready"
      ).length,
      blocked_games: games.filter((game) => game.projection.blocked.is_blocked)
        .length,
      games_with_both_starters: games.filter((game) => game.has_both_starters)
        .length,
      games_with_both_lineups: games.filter((game) => game.has_both_lineups)
        .length
    },
    counts: options.counts,
    games,
    note: options.note ?? null
  };
};
