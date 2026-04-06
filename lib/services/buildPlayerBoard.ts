import type {
  PlayerBoardCounts,
  PlayerBoardPayload,
  PlayerBoardRow
} from "@lib/contracts/player-board";
import {
  asGameId,
  asISOTimestamp,
  asPlayerId,
  asTeamId,
  type PlayerPosition
} from "@lib/contracts/types";
import {
  buildPlayerCards,
  type BuildPlayerCardOptions,
  type PlayerCard
} from "./buildPlayerCard";
import type { LiveSlateSourceGame } from "./loadLiveSlate";

export interface BuildPlayerBoardOptions {
  readonly source: string;
  readonly date: string;
  readonly counts: PlayerBoardCounts;
  readonly note?: string | null;
  readonly generated_at?: string;
  readonly simulation?: BuildPlayerCardOptions["simulation"];
}

const buildMatchupLabel = (sourceGame: LiveSlateSourceGame): string =>
  `${sourceGame.canonicalGame.away.team.full_name} at ${sourceGame.canonicalGame.home.team.full_name}`;

const buildFallbackPosition = (player: PlayerCard): PlayerPosition =>
  player.deterministic_summary?.kind === "pitcher" ? "P" : "unknown";

const buildProjection = (player: PlayerCard): PlayerBoardRow["projection"] => ({
  deterministic_summary: player.deterministic_summary,
  fantasy_summary: player.fantasy_summary,
  simulation_summary: player.simulation_summary,
  blocked: player.blocked
});

const buildPlayerBoardRows = (
  sourceGame: LiveSlateSourceGame,
  options: Pick<BuildPlayerBoardOptions, "simulation">
): readonly PlayerBoardRow[] => {
  const playerCards = buildPlayerCards(sourceGame.preparedGame, {
    ...(options.simulation ? { simulation: options.simulation } : {})
  });
  const matchup = buildMatchupLabel(sourceGame);

  return playerCards.players
    .map<PlayerBoardRow | null>((player) => {
      const isAwayPlayer = player.team_id === sourceGame.canonicalGame.away.team.team_id;
      const isHomePlayer = player.team_id === sourceGame.canonicalGame.home.team.team_id;

      if (!isAwayPlayer && !isHomePlayer) {
        return null;
      }

      const team = isAwayPlayer
        ? sourceGame.canonicalGame.away.team
        : sourceGame.canonicalGame.home.team;
      const opponent = isAwayPlayer
        ? sourceGame.canonicalGame.home.team
        : sourceGame.canonicalGame.away.team;
      const identity = sourceGame.playerIdentities[player.player_id];

      return {
        player_id: asPlayerId(player.player_id),
        full_name: identity?.full_name ?? null,
        position: identity?.position ?? buildFallbackPosition(player),
        batting_order: identity?.batting_order ?? null,
        team_side: isAwayPlayer ? "away" : "home",
        team_id: asTeamId(player.team_id),
        team_abbreviation: team.abbreviation,
        team_full_name: team.full_name,
        opponent_team_id: opponent.team_id,
        opponent_team_abbreviation: opponent.abbreviation,
        opponent_team_full_name: opponent.full_name,
        game_id: asGameId(player.game_id),
        matchup,
        scheduled_start: sourceGame.canonicalGame.scheduled_start,
        status: sourceGame.canonicalGame.status,
        venue_name: sourceGame.canonicalGame.venue?.name ?? null,
        projection: buildProjection(player)
      };
    })
    .filter((value): value is PlayerBoardRow => value !== null);
};

const isPitcherRow = (player: PlayerBoardRow): boolean =>
  player.position === "P" || player.projection.deterministic_summary?.kind === "pitcher";

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

const sortPlayerRows = (left: PlayerBoardRow, right: PlayerBoardRow): number => {
  if (left.projection.blocked.is_blocked !== right.projection.blocked.is_blocked) {
    return left.projection.blocked.is_blocked ? 1 : -1;
  }

  const startComparison = left.scheduled_start.localeCompare(right.scheduled_start);
  if (startComparison !== 0) {
    return startComparison;
  }

  if (isPitcherRow(left) !== isPitcherRow(right)) {
    return isPitcherRow(left) ? -1 : 1;
  }

  const fantasyComparison = compareNullableNumbersDesc(
    left.projection.fantasy_summary?.projected_points ?? null,
    right.projection.fantasy_summary?.projected_points ?? null
  );
  if (fantasyComparison !== 0) {
    return fantasyComparison;
  }

  const battingOrderComparison = compareNullableNumbersAsc(
    left.batting_order,
    right.batting_order
  );
  if (battingOrderComparison !== 0) {
    return battingOrderComparison;
  }

  return (left.full_name ?? left.player_id).localeCompare(
    right.full_name ?? right.player_id
  );
};

export const buildPlayerBoard = (
  sourceGames: readonly LiveSlateSourceGame[],
  options: BuildPlayerBoardOptions
): PlayerBoardPayload => {
  const players = sourceGames
    .flatMap((sourceGame) => buildPlayerBoardRows(sourceGame, options))
    .sort(sortPlayerRows);

  const pitchers = players.filter(isPitcherRow).length;
  const uniqueGames = new Set(players.map((player) => player.game_id));

  return {
    source: options.source,
    mode: "player-board-v1",
    date: options.date,
    generated_at: asISOTimestamp(options.generated_at ?? new Date().toISOString()),
    summary: {
      total_players: players.length,
      projected_players: players.filter((player) => !player.projection.blocked.is_blocked)
        .length,
      blocked_players: players.filter((player) => player.projection.blocked.is_blocked)
        .length,
      pitchers,
      batters: players.length - pitchers,
      games_covered: uniqueGames.size
    },
    counts: options.counts,
    players,
    note: options.note ?? null
  };
};
