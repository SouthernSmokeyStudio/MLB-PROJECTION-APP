import type {
  PlayerBoardPayload,
  PlayerBoardRow,
  PlayerBoardSummary
} from "@lib/contracts/player-board";
import {
  getPlayerProjectedPoints,
  isPitcherPlayer
} from "@lib/player-board";

export interface PlayerProjectionBoardHighlight {
  readonly full_name: string;
  readonly team_abbreviation: string;
  readonly position: string;
  readonly projected_points: number;
}

export interface PlayerProjectionBoardSummary extends PlayerBoardSummary {
  readonly ready_pitchers: number;
  readonly ready_batters: number;
  readonly top_projected_player: PlayerProjectionBoardHighlight | null;
}

export interface PlayerProjectionBoard {
  readonly source: string;
  readonly date: string;
  readonly generated_at: string;
  readonly note: string | null;
  readonly summary: PlayerProjectionBoardSummary;
  readonly ready_pitchers: readonly PlayerBoardRow[];
  readonly ready_batters: readonly PlayerBoardRow[];
  readonly held_players: readonly PlayerBoardRow[];
}

const compareNames = (left: PlayerBoardRow, right: PlayerBoardRow): number =>
  (left.full_name ?? left.player_id).localeCompare(right.full_name ?? right.player_id);

const compareNullableNumbersDesc = (left: number | null, right: number | null): number => {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return right - left;
};

const compareNullableNumbersAsc = (left: number | null, right: number | null): number => {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return left - right;
};

const sortPitchers = (left: PlayerBoardRow, right: PlayerBoardRow): number => {
  const projectedPointsComparison = compareNullableNumbersDesc(
    getPlayerProjectedPoints(left),
    getPlayerProjectedPoints(right)
  );
  if (projectedPointsComparison !== 0) {
    return projectedPointsComparison;
  }

  const startComparison = left.scheduled_start.localeCompare(right.scheduled_start);
  if (startComparison !== 0) {
    return startComparison;
  }

  return compareNames(left, right);
};

const sortBatters = (left: PlayerBoardRow, right: PlayerBoardRow): number => {
  const projectedPointsComparison = compareNullableNumbersDesc(
    getPlayerProjectedPoints(left),
    getPlayerProjectedPoints(right)
  );
  if (projectedPointsComparison !== 0) {
    return projectedPointsComparison;
  }

  const battingOrderComparison = compareNullableNumbersAsc(
    left.batting_order,
    right.batting_order
  );
  if (battingOrderComparison !== 0) {
    return battingOrderComparison;
  }

  const startComparison = left.scheduled_start.localeCompare(right.scheduled_start);
  if (startComparison !== 0) {
    return startComparison;
  }

  return compareNames(left, right);
};

const sortHeldPlayers = (left: PlayerBoardRow, right: PlayerBoardRow): number => {
  const startComparison = left.scheduled_start.localeCompare(right.scheduled_start);
  if (startComparison !== 0) {
    return startComparison;
  }

  if (isPitcherPlayer(left) !== isPitcherPlayer(right)) {
    return isPitcherPlayer(left) ? -1 : 1;
  }

  const battingOrderComparison = compareNullableNumbersAsc(
    left.batting_order,
    right.batting_order
  );
  if (battingOrderComparison !== 0) {
    return battingOrderComparison;
  }

  return compareNames(left, right);
};

export const buildPlayerProjectionBoard = (
  playerBoard: PlayerBoardPayload
): PlayerProjectionBoard => {
  const readyPlayers = playerBoard.players.filter(
    (player) => !player.projection.blocked.is_blocked
  );
  const readyPitchers = [...readyPlayers.filter(isPitcherPlayer)].sort(sortPitchers);
  const readyBatters = [...readyPlayers.filter((player) => !isPitcherPlayer(player))].sort(
    sortBatters
  );
  const heldPlayers = [
    ...playerBoard.players.filter((player) => player.projection.blocked.is_blocked)
  ].sort(sortHeldPlayers);

  const topProjectedPlayer = readyPlayers.reduce<PlayerBoardRow | null>((best, player) => {
    if (best === null) {
      return player;
    }

    return compareNullableNumbersDesc(
      getPlayerProjectedPoints(player),
      getPlayerProjectedPoints(best)
    ) < 0
      ? player
      : best;
  }, null);

  return {
    source: playerBoard.source,
    date: playerBoard.date,
    generated_at: playerBoard.generated_at,
    note: playerBoard.note,
    summary: {
      ...playerBoard.summary,
      ready_pitchers: readyPitchers.length,
      ready_batters: readyBatters.length,
      top_projected_player: topProjectedPlayer
        ? {
            full_name: topProjectedPlayer.full_name ?? topProjectedPlayer.player_id,
            team_abbreviation: topProjectedPlayer.team_abbreviation,
            position: topProjectedPlayer.position,
            projected_points: getPlayerProjectedPoints(topProjectedPlayer) ?? 0
          }
        : null
    },
    ready_pitchers: readyPitchers,
    ready_batters: readyBatters,
    held_players: heldPlayers
  };
};
