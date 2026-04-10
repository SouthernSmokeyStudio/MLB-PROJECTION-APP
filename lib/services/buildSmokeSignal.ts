import type { BettingEdgeBoardPayload } from "@lib/contracts/betting-edge-board";
import type { DfsEdgeBoardPayload } from "@lib/contracts/dfs-edge-board";
import type { LiveScoreboardPayload } from "@lib/contracts/live-scoreboard";
import type { PlayerBoardPayload } from "@lib/contracts/player-board";
import type { ScheduleBoardPayload } from "@lib/contracts/schedule-board";
import type {
  SmokeSignalBettingHighlight,
  SmokeSignalDfsHighlight,
  SmokeSignalGameHighlight,
  SmokeSignalLivePulse,
  SmokeSignalPayload,
  SmokeSignalPlayerHighlight
} from "@lib/contracts/smoke-signal";
import { asISOTimestamp } from "@lib/contracts/types";

export interface BuildSmokeSignalOptions {
  readonly source: string;
  readonly date: string;
  readonly generated_at?: string;
  readonly note?: string | null;
  readonly schedule: ScheduleBoardPayload;
  readonly player_projections: PlayerBoardPayload;
  readonly dfs_edge: DfsEdgeBoardPayload | null;
  readonly betting_edge: BettingEdgeBoardPayload | null;
  readonly live_scoreboard: LiveScoreboardPayload | null;
}

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

const buildTopProjectedTotalGame = (
  schedule: ScheduleBoardPayload
): SmokeSignalGameHighlight | null => {
  const game = [...schedule.games]
    .filter((entry) => !entry.projection.blocked.is_blocked && entry.projection.projected_total !== null)
    .sort((left, right) => {
      const totalComparison = compareNullableNumbersDesc(
        left.projection.projected_total,
        right.projection.projected_total
      );

      if (totalComparison !== 0) {
        return totalComparison;
      }

      return left.scheduled_start.localeCompare(right.scheduled_start);
    })[0];

  if (!game) {
    return null;
  }

  return {
    game_id: game.game_id,
    matchup: `${game.away_team.full_name} at ${game.home_team.full_name}`,
    scheduled_start: game.scheduled_start,
    status: game.status,
    projected_total: game.projection.projected_total,
    away_win_probability: game.projection.away_win_probability,
    home_win_probability: game.projection.home_win_probability,
    blocked: game.projection.blocked
  };
};

const buildTopProjectedPlayer = (
  playerBoard: PlayerBoardPayload
): SmokeSignalPlayerHighlight | null => {
  const player = [...playerBoard.players]
    .filter(
      (entry) =>
        !entry.projection.blocked.is_blocked &&
        entry.projection.fantasy_summary?.projected_points !== null &&
        entry.projection.fantasy_summary !== null
    )
    .sort((left, right) => {
      const pointsComparison = compareNullableNumbersDesc(
        left.projection.fantasy_summary?.projected_points ?? null,
        right.projection.fantasy_summary?.projected_points ?? null
      );

      if (pointsComparison !== 0) {
        return pointsComparison;
      }

      return left.scheduled_start.localeCompare(right.scheduled_start);
    })[0];

  if (!player) {
    return null;
  }

  return {
    player_id: player.player_id,
    full_name: player.full_name,
    team_abbreviation: player.team_abbreviation,
    position: player.position,
    game_id: player.game_id,
    matchup: player.matchup,
    projected_points: player.projection.fantasy_summary?.projected_points ?? null,
    blocked: player.projection.blocked
  };
};

const buildTopDfsValuePlayer = (
  dfsEdge: DfsEdgeBoardPayload | null
): SmokeSignalDfsHighlight | null => {
  if (!dfsEdge?.summary.top_value_player) {
    return null;
  }

  const highlightedRow = [...dfsEdge.ready_pitchers, ...dfsEdge.ready_batters].find(
    (row) => row.player_id === dfsEdge.summary.top_value_player?.player_id
  );

  return {
    player_id: dfsEdge.summary.top_value_player.player_id,
    full_name: dfsEdge.summary.top_value_player.full_name,
    team_abbreviation: dfsEdge.summary.top_value_player.team_abbreviation,
    position: dfsEdge.summary.top_value_player.position,
    projected_points: dfsEdge.summary.top_value_player.projected_points,
    salary: dfsEdge.summary.top_value_player.salary,
    value: dfsEdge.summary.top_value_player.value,
    draft_group_id: dfsEdge.draftkings_classic?.draft_group_id ?? null,
    projected_ownership: highlightedRow?.draftkings_classic.projected_ownership ?? null,
    ownership_source: highlightedRow?.draftkings_classic.ownership_source ?? null
  };
};

const buildTopBettingEdgeSide = (
  bettingEdge: BettingEdgeBoardPayload | null
): SmokeSignalBettingHighlight | null => {
  if (!bettingEdge?.summary.top_edge_side) {
    return null;
  }

  return {
    game_id: bettingEdge.summary.top_edge_side.game_id,
    matchup: bettingEdge.summary.top_edge_side.matchup,
    team_abbreviation: bettingEdge.summary.top_edge_side.team_abbreviation,
    team_full_name: bettingEdge.summary.top_edge_side.team_full_name,
    opponent_team_abbreviation: bettingEdge.summary.top_edge_side.opponent_team_abbreviation,
    market_odds_american: bettingEdge.summary.top_edge_side.market_odds_american,
    fair_american_odds: bettingEdge.summary.top_edge_side.fair_american_odds,
    model_probability: bettingEdge.summary.top_edge_side.model_probability,
    edge: bettingEdge.summary.top_edge_side.edge
  };
};

const buildLivePulse = (
  liveScoreboard: LiveScoreboardPayload | null
): SmokeSignalLivePulse | null => {
  if (!liveScoreboard || liveScoreboard.summary.total_games === 0) {
    return null;
  }

  return {
    total_games: liveScoreboard.summary.total_games,
    live_games: liveScoreboard.summary.live_games,
    final_games: liveScoreboard.summary.final_games,
    pregame_games: liveScoreboard.summary.pregame_games,
    blocked_games: liveScoreboard.summary.blocked_games
  };
};

const buildOverview = ({
  schedule,
  player_projections,
  live_scoreboard
}: Pick<
  BuildSmokeSignalOptions,
  "schedule" | "player_projections" | "live_scoreboard"
>) => ({
  total_games: schedule.summary.total_games,
  projection_ready_games: schedule.summary.projection_ready_games,
  player_ready_games: new Set(
    player_projections.players
      .filter((player) => !player.projection.blocked.is_blocked)
      .map((player) => player.game_id)
  ).size,
  live_games: live_scoreboard?.summary.live_games ?? 0,
  blocked_games: schedule.summary.blocked_games
});

const buildMissingSignalNote = (
  missingSignals: readonly string[],
  fallbackNote: string | null | undefined
): string | null => {
  if (missingSignals.length === 0) {
    return fallbackNote ?? null;
  }

  return fallbackNote ?? `Some Smoke Signal highlights are unavailable: ${missingSignals.join(", ")}.`;
};

export const buildSmokeSignal = (
  options: BuildSmokeSignalOptions
): SmokeSignalPayload => {
  const topProjectedTotalGame = buildTopProjectedTotalGame(options.schedule);
  const topProjectedPlayer = buildTopProjectedPlayer(options.player_projections);
  const topDfsValuePlayer = buildTopDfsValuePlayer(options.dfs_edge);
  const topBettingEdgeSide = buildTopBettingEdgeSide(options.betting_edge);
  const livePulse = buildLivePulse(options.live_scoreboard);

  const signals = [
    ["top_projected_total_game", topProjectedTotalGame],
    ["top_projected_player", topProjectedPlayer],
    ["top_dfs_value_player", topDfsValuePlayer],
    ["top_betting_edge_side", topBettingEdgeSide],
    ["live_pulse", livePulse]
  ] as const;

  const missingSignals = signals
    .filter(([, value]) => value === null)
    .map(([key]) => key);

  return {
    source: options.source,
    mode: "smoke-signal-v1",
    date: options.date,
    generated_at: asISOTimestamp(options.generated_at ?? new Date().toISOString()),
    summary: {
      total_sections_considered: signals.length,
      ready_signals: signals.length - missingSignals.length,
      blocked_signals: missingSignals.length
    },
    overview: buildOverview(options),
    top_projected_total_game: topProjectedTotalGame,
    top_projected_player: topProjectedPlayer,
    top_dfs_value_player: topDfsValuePlayer,
    top_betting_edge_side: topBettingEdgeSide,
    live_pulse: livePulse,
    note: buildMissingSignalNote(missingSignals, options.note)
  };
};
