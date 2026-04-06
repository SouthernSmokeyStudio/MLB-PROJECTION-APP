import type {
  ScheduleBoardGame,
  ScheduleBoardPayload
} from "@lib/contracts/schedule-board";
import type { BlockedState, GameId, GameStatus, ISOTimestamp } from "@lib/contracts/types";
import {
  buildAvailabilityLine,
  buildStarterLine,
  formatProbability
} from "@lib/schedule-board";

export interface GameProjectionHighlight {
  readonly matchup: string;
  readonly team_abbreviation: string | null;
  readonly value: number;
}

export interface GameProjectionBoardRow {
  readonly game_id: GameId;
  readonly matchup: string;
  readonly scheduled_start: ISOTimestamp;
  readonly status: GameStatus;
  readonly venue_name: string | null;
  readonly blocked: BlockedState;
  readonly projected_away_runs: number | null;
  readonly projected_home_runs: number | null;
  readonly projected_total: number | null;
  readonly average_total_runs: number | null;
  readonly away_win_probability: number | null;
  readonly home_win_probability: number | null;
  readonly favorite_team_abbreviation: string | null;
  readonly favorite_team_name: string | null;
  readonly favorite_win_probability: number | null;
  readonly projected_margin: number | null;
  readonly projected_margin_team_abbreviation: string | null;
  readonly completeness_score: number;
  readonly starter_summary: string;
  readonly availability_summary: string;
  readonly away_team: ScheduleBoardGame["away_team"];
  readonly home_team: ScheduleBoardGame["home_team"];
}

export interface GameProjectionBoardSummary {
  readonly total_games: number;
  readonly projection_ready_games: number;
  readonly games_ready_for_player_projections: number;
  readonly blocked_games: number;
  readonly average_ready_total: number | null;
  readonly highest_total: GameProjectionHighlight | null;
  readonly strongest_favorite: GameProjectionHighlight | null;
}

export interface GameProjectionBoard {
  readonly source: string;
  readonly date: string;
  readonly generated_at: ISOTimestamp;
  readonly note: string | null;
  readonly summary: GameProjectionBoardSummary;
  readonly games: readonly GameProjectionBoardRow[];
}

const buildMatchupLabel = (game: ScheduleBoardGame): string =>
  `${game.away_team.full_name} at ${game.home_team.full_name}`;

const getFavorite = (
  game: ScheduleBoardGame
): Pick<
  GameProjectionBoardRow,
  "favorite_team_abbreviation" | "favorite_team_name" | "favorite_win_probability"
> => {
  const away = game.projection.away_win_probability;
  const home = game.projection.home_win_probability;

  if (away === null || home === null) {
    return {
      favorite_team_abbreviation: null,
      favorite_team_name: null,
      favorite_win_probability: null
    };
  }

  if (away >= home) {
    return {
      favorite_team_abbreviation: game.away_team.abbreviation,
      favorite_team_name: game.away_team.full_name,
      favorite_win_probability: away
    };
  }

  return {
    favorite_team_abbreviation: game.home_team.abbreviation,
    favorite_team_name: game.home_team.full_name,
    favorite_win_probability: home
  };
};

const getProjectedMargin = (
  game: ScheduleBoardGame
): Pick<
  GameProjectionBoardRow,
  "projected_margin" | "projected_margin_team_abbreviation"
> => {
  const awayRuns = game.projection.projected_away_runs;
  const homeRuns = game.projection.projected_home_runs;

  if (awayRuns === null || homeRuns === null) {
    return {
      projected_margin: null,
      projected_margin_team_abbreviation: null
    };
  }

  if (awayRuns >= homeRuns) {
    return {
      projected_margin: awayRuns - homeRuns,
      projected_margin_team_abbreviation: game.away_team.abbreviation
    };
  }

  return {
    projected_margin: homeRuns - awayRuns,
    projected_margin_team_abbreviation: game.home_team.abbreviation
  };
};

const sortProjectionRows = (
  left: GameProjectionBoardRow,
  right: GameProjectionBoardRow
): number => {
  if (left.blocked.is_blocked !== right.blocked.is_blocked) {
    return left.blocked.is_blocked ? 1 : -1;
  }

  const leftFavorite = left.favorite_win_probability ?? -1;
  const rightFavorite = right.favorite_win_probability ?? -1;
  if (leftFavorite !== rightFavorite) {
    return rightFavorite - leftFavorite;
  }

  const leftTotal = left.projected_total ?? -1;
  const rightTotal = right.projected_total ?? -1;
  if (leftTotal !== rightTotal) {
    return rightTotal - leftTotal;
  }

  return left.scheduled_start.localeCompare(right.scheduled_start);
};

export const buildGameProjectionBoard = (
  scheduleBoard: ScheduleBoardPayload
): GameProjectionBoard => {
  const games = scheduleBoard.games
    .map<GameProjectionBoardRow>((game) => ({
      game_id: game.game_id,
      matchup: buildMatchupLabel(game),
      scheduled_start: game.scheduled_start,
      status: game.status,
      venue_name: game.venue_name,
      blocked: game.projection.blocked,
      projected_away_runs: game.projection.projected_away_runs,
      projected_home_runs: game.projection.projected_home_runs,
      projected_total: game.projection.projected_total,
      average_total_runs: game.projection.average_total_runs,
      away_win_probability: game.projection.away_win_probability,
      home_win_probability: game.projection.home_win_probability,
      ...getFavorite(game),
      ...getProjectedMargin(game),
      completeness_score: game.completeness_score,
      starter_summary: buildStarterLine(game),
      availability_summary: buildAvailabilityLine(game),
      away_team: game.away_team,
      home_team: game.home_team
    }))
    .sort(sortProjectionRows);

  const readyGames = games.filter((game) => !game.blocked.is_blocked);
  const totalReadyProjectedRuns = readyGames.reduce(
    (sum, game) => sum + (game.projected_total ?? 0),
    0
  );

  const highestTotalGame = readyGames.reduce<GameProjectionBoardRow | null>(
    (best, game) =>
      best === null || (game.projected_total ?? -1) > (best.projected_total ?? -1)
        ? game
        : best,
    null
  );

  const strongestFavoriteGame = readyGames.reduce<GameProjectionBoardRow | null>(
    (best, game) =>
      best === null ||
      (game.favorite_win_probability ?? -1) > (best.favorite_win_probability ?? -1)
        ? game
        : best,
    null
  );

  return {
    source: scheduleBoard.source,
    date: scheduleBoard.date,
    generated_at: scheduleBoard.generated_at,
    note: scheduleBoard.note,
    summary: {
      total_games: scheduleBoard.summary.total_games,
      projection_ready_games: readyGames.length,
      games_ready_for_player_projections:
        scheduleBoard.summary.games_ready_for_player_projections,
      blocked_games: scheduleBoard.summary.blocked_games,
      average_ready_total:
        readyGames.length === 0 ? null : totalReadyProjectedRuns / readyGames.length,
      highest_total: highestTotalGame
        ? {
            matchup: highestTotalGame.matchup,
            team_abbreviation: null,
            value: highestTotalGame.projected_total ?? 0
          }
        : null,
      strongest_favorite: strongestFavoriteGame
        ? {
            matchup: strongestFavoriteGame.matchup,
            team_abbreviation: strongestFavoriteGame.favorite_team_abbreviation,
            value: strongestFavoriteGame.favorite_win_probability ?? 0
          }
        : null
    },
    games
  };
};

export const formatProjectedRuns = (value: number | null): string =>
  value === null ? "--" : value.toFixed(1);

export const formatProjectedMarginLabel = (
  game: GameProjectionBoardRow
): string | null =>
  game.projected_margin === null || game.projected_margin_team_abbreviation === null
    ? null
    : `${game.projected_margin_team_abbreviation} +${game.projected_margin.toFixed(1)} runs`;

export const formatFavoriteLabel = (
  game: GameProjectionBoardRow
): string | null =>
  game.favorite_team_abbreviation === null || game.favorite_win_probability === null
    ? null
    : `${game.favorite_team_abbreviation} ${formatProbability(
        game.favorite_win_probability
      )} win`;

export const formatAverageTotalLabel = (
  game: GameProjectionBoardRow
): string | null =>
  game.average_total_runs === null
    ? null
    : `Avg ${game.average_total_runs.toFixed(1)} runs`;
