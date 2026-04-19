"use client";

import Image from "next/image";
import React, { startTransition, useEffect, useState } from "react";
import type { BettingEdgeBoardPayload } from "@lib/contracts/betting-edge-board";
import type { DfsEdgeBoardPayload } from "@lib/contracts/dfs-edge-board";
import type { LiveScoreboardPayload } from "@lib/contracts/live-scoreboard";
import type { PlayerBoardPayload } from "@lib/contracts/player-board";
import type { ScheduleBoardPayload, ScheduleBoardSummary } from "@lib/contracts/schedule-board";
import type { SmokeSignalPayload } from "@lib/contracts/smoke-signal";
import { formatAmericanOdds, formatBettingEdgePercent, formatBettingEdgeProbability, formatBettingEdgeStatus, formatFairAmericanOdds, getBettingEdgeLeader } from "@lib/betting-edge-board";
import { formatDfsEdgeStatus, formatDraftKingsClassicSalary, formatDraftKingsClassicValue } from "@lib/dfs-edge-board";
import { buildPlayerDetailSummary, buildPlayerRoleLabel, buildPlayerStatSummary, formatPlayerProjectedPoints, formatPlayerProjectionStatus, getPlayerProjectedPoints } from "@lib/player-board";
import {
  EMPTY_SCHEDULE_SUMMARY,
  buildAvailabilityLine,
  buildStarterLine,
  formatBoardDate,
  formatFairOddsLabel,
  formatGameTypeLabel,
  formatGeneratedStamp,
  formatProjectionEdgeLabel,
  formatProjectedTotalLabel,
  formatProjectionReadyLabel,
  formatScheduledStart,
  formatSourceLabel,
  formatStatusLabel,
  getErrorMessage,
  readResponseError,
} from "@lib/schedule-board";
import { parseSlateSnapshotPayload } from "@lib/slate-snapshot";

export const DASHBOARD_TABS = [
  { id: "schedule", label: "Schedule" },
  { id: "game-projections", label: "Game Projections" },
  { id: "player-projections", label: "Player Projections" },
  { id: "dfs-edge", label: "DFS Edge" },
  { id: "betting-edge", label: "Betting Edge" },
  { id: "smoke-signal", label: "Smoke Signal" },
] as const;

type DashboardTabId = (typeof DASHBOARD_TABS)[number]["id"];

interface ScheduleState {
  readonly status: "loading" | "success" | "empty" | "error";
  readonly board: ScheduleBoardPayload | null;
  readonly error: string | null;
  readonly note: string | null;
}

interface PlayerState {
  readonly status: "loading" | "success" | "empty" | "error";
  readonly board: PlayerBoardPayload | null;
  readonly error: string | null;
  readonly note: string | null;
}

interface DfsState {
  readonly status: "loading" | "success" | "empty" | "error";
  readonly board: DfsEdgeBoardPayload | null;
  readonly error: string | null;
  readonly note: string | null;
}

interface BettingState {
  readonly status: "loading" | "success" | "empty" | "error";
  readonly board: BettingEdgeBoardPayload | null;
  readonly error: string | null;
  readonly note: string | null;
}

interface LiveScoreboardState {
  readonly status: "loading" | "success" | "empty" | "error";
  readonly board: LiveScoreboardPayload | null;
  readonly error: string | null;
  readonly note: string | null;
}

interface SmokeSignalState {
  readonly status: "loading" | "success" | "empty" | "error";
  readonly board: SmokeSignalPayload | null;
  readonly error: string | null;
  readonly note: string | null;
}

const SNAPSHOT_ROUTE = "/api/slate-snapshot";
const LOGO_SRC = "/sss-baseball-logo.png";

const INITIAL_SCHEDULE_STATE: ScheduleState = {
  status: "loading",
  board: null,
  error: null,
  note: null,
};

const INITIAL_PLAYER_STATE: PlayerState = {
  status: "loading",
  board: null,
  error: null,
  note: null,
};

const INITIAL_DFS_STATE: DfsState = {
  status: "loading",
  board: null,
  error: null,
  note: null,
};

const INITIAL_BETTING_STATE: BettingState = {
  status: "loading",
  board: null,
  error: null,
  note: null,
};

const INITIAL_LIVE_SCOREBOARD_STATE: LiveScoreboardState = {
  status: "loading",
  board: null,
  error: null,
  note: null,
};

const INITIAL_SMOKE_SIGNAL_STATE: SmokeSignalState = {
  status: "loading",
  board: null,
  error: null,
  note: null,
};

interface BoardPopulationCopy {
  readonly title: string;
  readonly body: string;
}

const buildGameDetailButtonLabel = (
  game: ScheduleBoardPayload["games"][number]
): string => `Open game detail for ${game.away_team.abbreviation} at ${game.home_team.abbreviation}`;

export const formatStatusRailMatchup = (
  game: LiveScoreboardPayload["games"][number]
): string =>
  game.away_score === null || game.home_score === null
    ? `${game.away_team_abbreviation} at ${game.home_team_abbreviation}`
    : `${game.away_team_abbreviation} ${game.away_score} at ${game.home_team_abbreviation} ${game.home_score}`;

export const formatStatusRailBadge = (
  game: LiveScoreboardPayload["games"][number]
): string => {
  if (game.blocked.is_blocked) {
    return "Score blocked";
  }

  if (game.is_final) {
    return "Final";
  }

  if (game.is_live) {
    return game.display_state ?? "Live";
  }

  return formatStatusLabel(game.status);
};

export const formatStatusRailPrimaryMeta = (
  game: LiveScoreboardPayload["games"][number]
): string => {
  if (game.blocked.is_blocked) {
    return game.blocked.blocked_reason ?? "Live score blocked";
  }

  if (game.is_live || game.is_final) {
    return game.display_state ?? formatStatusLabel(game.status);
  }

  return formatScheduledStart(game.scheduled_start);
};

const formatSmokeSignalTotal = (
  signal: SmokeSignalPayload["top_projected_total_game"]
): string =>
  signal === null || signal.projected_total === null
    ? "Projected total unavailable"
    : `${signal.projected_total.toFixed(1)} total | ${formatStatusLabel(signal.status)}`;

const formatSmokeSignalPlayer = (
  signal: SmokeSignalPayload["top_projected_player"]
): string =>
  signal === null
    ? "Projected player unavailable"
    : `${signal.team_abbreviation} | ${
        signal.projected_points === null ? "Projected points unavailable" : `${signal.projected_points.toFixed(1)} pts`
      }`;

const formatSmokeSignalDfs = (
  signal: SmokeSignalPayload["top_dfs_value_player"]
): string =>
  signal === null
    ? "DFS value unavailable"
    : `${formatDraftKingsClassicSalary(signal.salary)} | ${formatDraftKingsClassicValue(signal.value)} | ${
        signal.projected_ownership === null ? "Ownership unavailable" : `${(signal.projected_ownership * 100).toFixed(1)}% own`
      }`;

const formatSmokeSignalBetting = (
  signal: SmokeSignalPayload["top_betting_edge_side"]
): string =>
  signal === null
    ? "Betting edge unavailable"
    : `${signal.team_abbreviation} ${formatAmericanOdds(signal.market_odds_american)} | ${formatBettingEdgePercent(signal.edge)}`;

const formatSmokeSignalPulse = (
  signal: SmokeSignalPayload["live_pulse"]
): string =>
  signal === null
    ? "Live pulse unavailable"
    : `${signal.live_games} live | ${signal.final_games} final | ${signal.pregame_games} pregame | ${signal.blocked_games} blocked`;

const SmokeSignalCard = ({
  eyebrow,
  title,
  body,
  blocked,
}: {
  eyebrow: string;
  title: string;
  body: string;
  blocked: boolean;
}) => (
  <article className={`placeholder-panel-card ${blocked ? "muted" : ""}`}>
    <p className="workspace-eyebrow">{eyebrow}</p>
    <h3>{title}</h3>
    <p>{body}</p>
  </article>
);

const buildPlayerBoardPopulationCopy = (board: PlayerBoardPayload | null): BoardPopulationCopy | null => {
  if (!board) {
    return null;
  }

  if (board.summary.projected_players === 0) {
    return {
      title: "Player board is still building.",
      body: "This board fills once projected matchups have cleared into live player rows.",
    };
  }

  if (board.summary.blocked_players > 0) {
    return {
      title: "Some matchups haven't reached the player board yet.",
      body: "The player board is live, but some matchups are still held.",
    };
  }

  return null;
};

const buildDfsBoardPopulationCopy = (board: DfsEdgeBoardPayload | null): BoardPopulationCopy | null => {
  if (!board) {
    return null;
  }

  if (board.summary.ready_players === 0) {
    return {
      title: "DraftKings Classic salary hasn't populated the board yet.",
      body: "DFS Edge only shows players who have a live DraftKings Classic salary.",
    };
  }

  if (board.held_players.length > 0) {
    return {
      title: "Some players are waiting on a DraftKings Classic salary.",
      body: "Only players with a live DraftKings Classic salary appear on the ready side.",
    };
  }

  return null;
};

const buildBettingBoardPopulationCopy = (board: BettingEdgeBoardPayload | null): BoardPopulationCopy | null => {
  if (!board) {
    return null;
  }

  if (board.summary.ready_games === 0) {
    return {
      title: "No moneyline-ready matchups yet.",
      body: "Betting Edge only shows matchups that have a DraftKings Sportsbook pregame moneyline.",
    };
  }

  if (board.held_games.length > 0) {
    return {
      title: "Some matchups are still waiting on a moneyline.",
      body: "Only matchups with a DraftKings Sportsbook pregame moneyline appear on the ready side.",
    };
  }

  return null;
};

const getReadyGames = (
  scheduleBoard: ScheduleBoardPayload | null
): readonly ScheduleBoardPayload["games"][number][] =>
  scheduleBoard?.games.filter((game) => !game.projection.blocked.is_blocked) ?? [];

const getHighestProjectedTotalGame = (
  scheduleBoard: ScheduleBoardPayload | null
): ScheduleBoardPayload["games"][number] | null =>
  getReadyGames(scheduleBoard).reduce<ScheduleBoardPayload["games"][number] | null>(
    (best, game) =>
      best === null ||
      (game.projection.projected_total ?? -1) > (best.projection.projected_total ?? -1)
        ? game
        : best,
    null
  );

const getStrongestFavoriteGame = (
  scheduleBoard: ScheduleBoardPayload | null
): ScheduleBoardPayload["games"][number] | null =>
  getReadyGames(scheduleBoard).reduce<ScheduleBoardPayload["games"][number] | null>(
    (best, game) => {
      const gameFavorite = Math.max(
        game.projection.away_win_probability ?? -1,
        game.projection.home_win_probability ?? -1
      );
      const bestFavorite =
        best === null
          ? -1
          : Math.max(
              best.projection.away_win_probability ?? -1,
              best.projection.home_win_probability ?? -1
            );

      return best === null || gameFavorite > bestFavorite ? game : best;
    },
    null
  );

const getFavoriteTeamAbbreviation = (
  game: ScheduleBoardPayload["games"][number]
): string | null => {
  const away = game.projection.away_win_probability;
  const home = game.projection.home_win_probability;

  if (away === null || home === null) {
    return null;
  }

  return away >= home ? game.away_team.abbreviation : game.home_team.abbreviation;
};

const getFavoriteProbability = (
  game: ScheduleBoardPayload["games"][number]
): number | null => {
  const away = game.projection.away_win_probability;
  const home = game.projection.home_win_probability;

  if (away === null || home === null) {
    return null;
  }

  return Math.max(away, home);
};

const buildFavoriteLabel = (
  game: ScheduleBoardPayload["games"][number]
): string | null => {
  const favoriteTeamAbbreviation = getFavoriteTeamAbbreviation(game);
  const favoriteProbability = getFavoriteProbability(game);

  return favoriteTeamAbbreviation === null || favoriteProbability === null
    ? null
    : `${favoriteTeamAbbreviation} ${(favoriteProbability * 100).toFixed(1)}% win`;
};

const buildProjectedMarginLabel = (
  game: ScheduleBoardPayload["games"][number]
): string | null => {
  const awayRuns = game.projection.projected_away_runs;
  const homeRuns = game.projection.projected_home_runs;

  if (awayRuns === null || homeRuns === null) {
    return null;
  }

  if (awayRuns >= homeRuns) {
    return `${game.away_team.abbreviation} +${(awayRuns - homeRuns).toFixed(1)} runs`;
  }

  return `${game.home_team.abbreviation} +${(homeRuns - awayRuns).toFixed(1)} runs`;
};

const buildAverageTotalLabel = (
  game: ScheduleBoardPayload["games"][number]
): string | null =>
  game.projection.average_total_runs === null
    ? null
    : `Avg ${game.projection.average_total_runs.toFixed(1)} runs`;

const formatProjectedRuns = (value: number | null): string =>
  value === null ? "--" : value.toFixed(1);

const getReadyPlayers = (playerBoard: PlayerBoardPayload | null) =>
  playerBoard?.players.filter((player) => !player.projection.blocked.is_blocked) ?? [];

const getReadyPitchers = (playerBoard: PlayerBoardPayload | null) =>
  getReadyPlayers(playerBoard).filter((player) => player.position === "P");

const getReadyBatters = (playerBoard: PlayerBoardPayload | null) =>
  getReadyPlayers(playerBoard).filter((player) => player.position !== "P");

const getHeldPlayers = (playerBoard: PlayerBoardPayload | null) =>
  playerBoard?.players.filter((player) => player.projection.blocked.is_blocked) ?? [];

const getTopProjectedPlayer = (playerBoard: PlayerBoardPayload | null) =>
  getReadyPlayers(playerBoard).reduce<PlayerBoardPayload["players"][number] | null>(
    (best, player) => {
      const playerPoints = getPlayerProjectedPoints(player) ?? -1;
      const bestPoints = best === null ? -1 : getPlayerProjectedPoints(best) ?? -1;

      return best === null || playerPoints > bestPoints ? player : best;
    },
    null
  );

const BoardPopulationNote = ({ copy }: { copy: BoardPopulationCopy | null }) =>
  copy ? (
    <div className="board-state-note">
      <strong>{copy.title}</strong>
      <p>{copy.body}</p>
    </div>
  ) : null;

const GameDetailDrawer = ({ game, onClose }: { game: ScheduleBoardPayload["games"][number]; onClose: () => void }) => {
  const edgeLabel = formatProjectionEdgeLabel(game);
  const totalLabel = formatProjectedTotalLabel(game);
  const favoriteSummary = edgeLabel ?? "Projected matchup view is still waiting on full starter and lineup carry.";
  const runSpreadLabel = (() => {
    const away = game.projection.projected_away_runs;
    const home = game.projection.projected_home_runs;
    if (away === null || home === null) return "Pending";
    const diff = away - home;
    if (diff === 0) return "Pick";
    const leader = diff > 0 ? game.away_team.abbreviation : game.home_team.abbreviation;
    return `${leader} by ${Math.abs(diff).toFixed(1)}`;
  })();

  return (
    <div className="game-detail-overlay" role="presentation" onClick={onClose}>
      <aside
        aria-labelledby="game-detail-title"
        aria-modal="true"
        className="game-detail-drawer"
        role="dialog"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="game-detail-header">
          <div className="game-detail-header-copy">
            <p className="workspace-eyebrow">Game Detail</p>
            <h2 id="game-detail-title">
              {game.away_team.full_name} at {game.home_team.full_name}
            </h2>
          </div>
          <button className="game-detail-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="game-detail-chip-row">
          <span className="workspace-pill">{formatStatusLabel(game.status)}</span>
          <span className="workspace-pill">{formatScheduledStart(game.scheduled_start)}</span>
          <span className="workspace-pill">{formatProjectionReadyLabel(game)}</span>
          <span className="workspace-pill">{game.player_projection_status === "ready" ? "Player Projections live" : "Player Projections waiting"}</span>
        </div>

        <section className="game-detail-card">
          <div className="game-detail-card-header">
            <strong>Game Projection Summary</strong>
            <span>{game.venue_name ?? "Venue pending"}</span>
          </div>
          <div className="game-detail-facts">
            <div className="game-detail-fact">
              <span className="game-detail-fact-label">Projected Final</span>
              <p className="game-detail-fact-copy">
                {game.projection.projected_away_runs !== null && game.projection.projected_home_runs !== null
                  ? `${game.away_team.abbreviation} ${formatProjectedRuns(game.projection.projected_away_runs)} \u2013 ${game.home_team.abbreviation} ${formatProjectedRuns(game.projection.projected_home_runs)}`
                  : "Pending"}
              </p>
            </div>
            <div className="game-detail-fact">
              <span className="game-detail-fact-label">Win Probability</span>
              <p className="game-detail-fact-copy">{formatProjectionEdgeLabel(game) ?? "Pending"}</p>
            </div>
            <div className="game-detail-fact">
              <span className="game-detail-fact-label">Fair Odds</span>
              <p className="game-detail-fact-copy">{formatFairOddsLabel(game) ?? "Pending"}</p>
            </div>
            <div className="game-detail-fact">
              <span className="game-detail-fact-label">Game Type</span>
              <p className="game-detail-fact-copy">{formatGameTypeLabel(game)}</p>
            </div>
            <div className="game-detail-fact">
              <span className="game-detail-fact-label">Projected Total Runs</span>
              <p className="game-detail-fact-copy">{formatProjectedTotalLabel(game) ?? "Pending"}</p>
            </div>
            <div className="game-detail-fact">
              <span className="game-detail-fact-label">Run Spread</span>
              <p className="game-detail-fact-copy">{runSpreadLabel}</p>
            </div>
          </div>
        </section>

        <section className="game-detail-card">
          <div className="game-detail-card-header">
            <strong>Projected game view</strong>
            <span>{favoriteSummary}</span>
          </div>
          {game.projection.blocked.is_blocked ? (
            <p className="game-detail-copy">Matchup projections stay off the ready side until the current slate carries the starter and lineup truth this board expects.</p>
          ) : (
            <>
              <div className="projection-scoreline game-detail-scoreline">
                <div className="projection-score-team">
                  <span>{game.away_team.abbreviation}</span>
                  <strong>{formatProjectedRuns(game.projection.projected_away_runs)}</strong>
                </div>
                <div className="projection-score-divider">proj</div>
                <div className="projection-score-team">
                  <span>{game.home_team.abbreviation}</span>
                  <strong>{formatProjectedRuns(game.projection.projected_home_runs)}</strong>
                </div>
              </div>
              <div className="projection-chip-row">
                {edgeLabel ? <span className="signal-chip signal-chip-primary">{edgeLabel}</span> : null}
                {totalLabel ? <span className="signal-chip signal-chip-neutral">{totalLabel}</span> : null}
                <span className="signal-chip signal-chip-neutral">{game.venue_name ?? "Venue pending"}</span>
              </div>
            </>
          )}
        </section>
      </aside>
    </div>
  );
};

const StatusRail = ({
  scheduleBoard,
  liveScoreboardState,
  liveScoreboard,
  summary,
  onOpenGameDetail,
}: {
  scheduleBoard: ScheduleBoardPayload | null;
  liveScoreboardState: LiveScoreboardState;
  liveScoreboard: LiveScoreboardPayload | null;
  summary: ScheduleBoardSummary;
  onOpenGameDetail: (gameId: ScheduleBoardPayload["games"][number]["game_id"]) => void;
}) => (
  <aside className="status-rail" aria-label="Slate status rail">
    <div className="status-brand-card">
      <div className="status-brand-cap">
        <span>Southern Smokey Studio</span>
        <span>MLB Dashboard</span>
      </div>
      <div className="status-brand-logo-frame">
        <div className="status-brand-logo">
          <Image src={LOGO_SRC} alt="Southern Smokey Studio logo" fill priority sizes="220px" />
        </div>
      </div>
      <div className="status-brand-banner">
        <span>Daily Slate</span>
        <span>Schedule Live</span>
      </div>
    </div>

    <div className="status-score-card">
      <div className="status-score-strip">
        <span>{scheduleBoard ? formatBoardDate(scheduleBoard.date) : "Today"}</span>
        <span>MLB</span>
        <span>{scheduleBoard ? formatSourceLabel(scheduleBoard.source) : "Feed pending"}</span>
      </div>
      <div className="status-score-heading">
        <strong>Slate Snapshot</strong>
        <span>{scheduleBoard ? `${summary.games_with_both_starters} with starters` : "Waiting on feed"}</span>
      </div>
      <div className="status-score-grid">
        <div className="status-score-cell">
          <strong>{summary.total_games}</strong>
          <span>Matchups</span>
        </div>
        <div className="status-score-cell">
          <strong>{summary.projection_ready_games}</strong>
          <span>Ready</span>
        </div>
        <div className="status-score-cell">
          <strong>{summary.blocked_games}</strong>
          <span>Blocked</span>
        </div>
      </div>
      <div className="status-score-bottomline">
        <span>{scheduleBoard ? `Built ${formatGeneratedStamp(scheduleBoard.generated_at)}` : "Waiting on update"}</span>
        <span>{scheduleBoard ? `${summary.games_ready_for_player_projections} player-ready` : "No counts yet"}</span>
      </div>
    </div>

    <div className="status-list-card">
      <div className="status-list-header">
        <span>Board Watch</span>
        <span>All Games</span>
      </div>
      {liveScoreboardState.status === "loading" ? <div className="status-rail-note">Loading today&apos;s board.</div> : null}
      {liveScoreboardState.status === "error" ? <div className="status-rail-note error">The shell is live, but the live scoreboard could not load.</div> : null}
      {liveScoreboardState.status === "empty" ? <div className="status-rail-note">{liveScoreboardState.note ?? liveScoreboard?.note ?? "The feed is up, but there is no live scoreboard state on the board yet."}</div> : null}
      {liveScoreboardState.status === "success" && liveScoreboard ? (
        <div className="status-list" style={{ overflowY: "auto", maxHeight: "480px" }}>
          {liveScoreboard.games.map((game) => (
            <div className={`status-list-row is-clickable ${game.blocked.is_blocked ? "rejected" : "approved"}`} key={game.game_id}>
              <button
                aria-label={`Open game detail for ${game.away_team_abbreviation} at ${game.home_team_abbreviation}`}
                className="detail-hitarea"
                type="button"
                onClick={() => {
                  onOpenGameDetail(game.game_id);
                }}
              />
              <div className="status-list-topline">
                <span className={`status-list-badge ${game.blocked.is_blocked ? "rejected" : "approved"}`}>{formatStatusRailBadge(game)}</span>
                <span className="status-list-tier">{formatStatusLabel(game.status)}</span>
              </div>
              <strong>{formatStatusRailMatchup(game)}</strong>
              <div className="status-list-meta">
                <span>{formatStatusRailPrimaryMeta(game)}</span>
                <span>{game.venue_name ?? "Venue pending"}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="rail-footer-note">Schedule, Game Projections, Player Projections, DFS Edge, and Betting Edge are live in this phase.</div>
    </div>
  </aside>
);

const ScheduleWorkspace = ({
  scheduleState,
  scheduleBoard,
  summary,
  onOpenGameDetail,
}: {
  scheduleState: ScheduleState;
  scheduleBoard: ScheduleBoardPayload | null;
  summary: ScheduleBoardSummary;
  onOpenGameDetail: (gameId: ScheduleBoardPayload["games"][number]["game_id"]) => void;
}) => {
  const [filter, setFilter] = useState<"all" | "ready" | "held">("all");

  return (
  <section className="workspace-panel" role="tabpanel" aria-labelledby="tab-schedule">
    <div className="workspace-header">
      <div className="workspace-header-copy">
        <p className="workspace-eyebrow">Schedule</p>
        <h2>Today&apos;s Slate</h2>
        <p className="workspace-copy">Start time, status, venue, listed starters, lineup coverage, and projection readiness come straight from the live route. Weather and score surfaces stay out until they are real.</p>
      </div>
      <div className="workspace-pill-stack">
        <span className="workspace-pill">{scheduleBoard ? formatSourceLabel(scheduleBoard.source) : "Feed pending"}</span>
        <span className="workspace-pill">{summary.total_games} matchups</span>
        <span className="workspace-pill">{scheduleBoard ? `Built ${formatGeneratedStamp(scheduleBoard.generated_at)}` : "Waiting on update"}</span>
      </div>
    </div>

    <div className="workspace-board-heading">
      <div>
        <span className="workspace-board-kicker">Daily board</span>
        <h3 className="workspace-board-title">Today&apos;s Games</h3>
      </div>
      <p className="workspace-board-note">
        {summary.projection_ready_games} ready | {summary.games_ready_for_player_projections} player-ready
      </p>
    </div>

    {scheduleState.status === "loading" ? (
      <div className="schedule-state">
        <p className="workspace-eyebrow">Loading</p>
        <h3>Loading today&apos;s board</h3>
        <p>The shell is live. The Schedule board has not landed yet.</p>
      </div>
    ) : null}
    {scheduleState.status === "error" ? (
      <div className="schedule-state schedule-state-error" role="alert">
        <p className="workspace-eyebrow">Feed Error</p>
        <h3>The Schedule board could not be rendered.</h3>
        <p>{scheduleState.error}</p>
      </div>
    ) : null}
    {scheduleState.status === "empty" ? (
      <div className="schedule-state">
        <p className="workspace-eyebrow">No Board</p>
        <h3>There are no matchups to show right now.</h3>
        <p>{scheduleState.note ?? scheduleBoard?.note ?? "The route responded, but the board is empty."}</p>
      </div>
    ) : null}

    {scheduleState.status === "success" && scheduleBoard ? (
      <>
        <div className="board-controls">
          <span className="board-controls-label">Show</span>
          {(["all", "ready", "held"] as const).map((f) => (
            <button
              key={f}
              className={`board-control-btn ${filter === f ? "active" : ""}`}
              type="button"
              onClick={() => { setFilter(f); }}
            >
              {f === "all" ? "All" : f === "ready" ? "Ready" : "Held"}
            </button>
          ))}
        </div>
        <div className="schedule-board">
        <div className="schedule-board-title">Today&apos;s Board</div>
        <div className="schedule-match-list">
          {scheduleBoard.games
              .filter((game) => filter === "all" || (filter === "ready" ? !game.projection.blocked.is_blocked : game.projection.blocked.is_blocked))
              .map((game) => {
            const edgeLabel = formatProjectionEdgeLabel(game);
            const totalLabel = formatProjectedTotalLabel(game);
            const completenessLabel = `${Math.round(game.completeness_score * 100)}% inputs`;

            return (
              <article className={`schedule-match is-clickable ${game.projection.blocked.is_blocked ? "rejected" : "approved"}`} key={game.game_id}>
                <button
                  aria-label={buildGameDetailButtonLabel(game)}
                  className="detail-hitarea"
                  type="button"
                  onClick={() => {
                    onOpenGameDetail(game.game_id);
                  }}
                />
                <div className="schedule-match-header">
                  <p className={`schedule-match-kicker ${game.projection.blocked.is_blocked ? "rejected" : "approved"}`}>
                    {formatStatusLabel(game.status)} | {formatScheduledStart(game.scheduled_start)}
                  </p>
                  <span className="schedule-match-stamp">{game.venue_name ?? "Venue pending"}</span>
                </div>
                <div className="schedule-match-body">
                  <div className="schedule-match-copy">
                    <h3>
                      {game.away_team.full_name} at {game.home_team.full_name}
                    </h3>
                    <p className="schedule-match-note">{buildStarterLine(game)}</p>
                    <p className="schedule-match-subnote">{buildAvailabilityLine(game)}</p>
                  </div>
                  <div className="schedule-match-actions">
                    <div className="schedule-chip-row">
                      {edgeLabel ? <span className="signal-chip signal-chip-primary">{edgeLabel}</span> : <span className="signal-chip signal-chip-neutral">Projection blocked</span>}
                      {totalLabel ? <span className="signal-chip signal-chip-neutral">{totalLabel}</span> : <span className="signal-chip signal-chip-neutral">{completenessLabel}</span>}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <div className="schedule-board-footer">
          <span>{summary.total_games} games</span>
          <span>{summary.projection_ready_games} ready</span>
          <span>{summary.games_ready_for_player_projections} player-ready</span>
          <span>{summary.blocked_games} blocked</span>
          <span>{summary.games_with_both_starters} with both starters</span>
          <span>{scheduleBoard ? `Built ${formatGeneratedStamp(scheduleBoard.generated_at)}` : "Waiting on update"}</span>
        </div>
      </div>
      </>
    ) : null}
  </section>
  );
};

const GameProjectionsWorkspace = ({
  scheduleState,
  scheduleBoard,
  onOpenGameDetail,
}: {
  scheduleState: ScheduleState;
  scheduleBoard: ScheduleBoardPayload | null;
  onOpenGameDetail: (gameId: ScheduleBoardPayload["games"][number]["game_id"]) => void;
}) => {
  const [filter, setFilter] = useState<"all" | "ready" | "held">("all");
  const [sortBy, setSortBy] = useState<"default" | "total">("default");
  const readyGames = getReadyGames(scheduleBoard);
  const strongestFavoriteGame = getStrongestFavoriteGame(scheduleBoard);
  const highestTotalGame = getHighestProjectedTotalGame(scheduleBoard);
  const averageReadyTotal =
    readyGames.length === 0
      ? null
      : readyGames.reduce(
          (sum, game) => sum + (game.projection.projected_total ?? 0),
          0
        ) / readyGames.length;

  return (
  <section className="workspace-panel" role="tabpanel" aria-labelledby="tab-game-projections">
    <div className="workspace-header">
      <div className="workspace-header-copy">
        <p className="workspace-eyebrow">Game Projections</p>
        <h2>Modeled Matchups</h2>
        <p className="workspace-copy">This board makes the matchup projection itself primary: projected score, favorite, run margin, total, and blocked state from the live route. No market lines, weather overlays, or injury dressing.</p>
      </div>
      <div className="workspace-pill-stack">
        <span className="workspace-pill">{scheduleBoard ? formatSourceLabel(scheduleBoard.source) : "Feed pending"}</span>
        <span className="workspace-pill">{scheduleBoard ? `${readyGames.length} ready` : "Waiting on projections"}</span>
        <span className="workspace-pill">{scheduleBoard ? `Built ${formatGeneratedStamp(scheduleBoard.generated_at)}` : "Waiting on update"}</span>
      </div>
    </div>

    <div className="workspace-board-heading">
      <div>
        <span className="workspace-board-kicker">Projection board</span>
        <h3 className="workspace-board-title">Today&apos;s Models</h3>
      </div>
      <p className="workspace-board-note">
        {strongestFavoriteGame
          ? `${getFavoriteTeamAbbreviation(strongestFavoriteGame)} ${(
              (getFavoriteProbability(strongestFavoriteGame) ?? 0) * 100
            ).toFixed(1)}% top favorite`
          : "No ready projections yet"}
      </p>
    </div>

    {scheduleState.status === "loading" ? (
      <div className="schedule-state">
        <p className="workspace-eyebrow">Loading</p>
        <h3>Loading matchup projections</h3>
        <p>The live route is up. Projection rows have not landed yet.</p>
      </div>
    ) : null}
    {scheduleState.status === "error" ? (
      <div className="schedule-state schedule-state-error" role="alert">
        <p className="workspace-eyebrow">Feed Error</p>
        <h3>The projection board could not be rendered.</h3>
        <p>{scheduleState.error}</p>
      </div>
    ) : null}
    {scheduleState.status === "empty" ? (
      <div className="schedule-state">
        <p className="workspace-eyebrow">No Board</p>
        <h3>There are no matchup projections to show right now.</h3>
        <p>{scheduleState.note ?? scheduleBoard?.note ?? "The route responded, but the board is empty."}</p>
      </div>
    ) : null}

    {scheduleState.status === "success" && scheduleBoard ? (
      <>
        <div className="board-controls">
          <span className="board-controls-label">Show</span>
          {(["all", "ready", "held"] as const).map((f) => (
            <button
              key={f}
              className={`board-control-btn ${filter === f ? "active" : ""}`}
              type="button"
              onClick={() => { setFilter(f); }}
            >
              {f === "all" ? "All" : f === "ready" ? "Ready" : "Held"}
            </button>
          ))}
          <span className="board-controls-divider" />
          <span className="board-controls-label">Sort</span>
          {(["default", "total"] as const).map((s) => (
            <button
              key={s}
              className={`board-control-btn ${sortBy === s ? "active" : ""}`}
              type="button"
              onClick={() => { setSortBy(s); }}
            >
              {s === "default" ? "Default" : "By Total"}
            </button>
          ))}
        </div>
        <div className="projection-board">
        <div className="projection-board-title">Modeled Matchups</div>
        <div className="projection-summary-strip">
          <span>{scheduleBoard.summary.total_games} games</span>
          <span>{readyGames.length} ready</span>
          <span>{scheduleBoard.summary.games_ready_for_player_projections} player-ready</span>
          <span>{scheduleBoard.summary.blocked_games} blocked</span>
          <span>{highestTotalGame ? `Highest total ${(highestTotalGame.projection.projected_total ?? 0).toFixed(1)}` : "No total yet"}</span>
          <span>{averageReadyTotal === null ? "No ready average" : `Avg ready total ${averageReadyTotal.toFixed(1)}`}</span>
        </div>
        <div className="projection-match-list">
          {scheduleBoard.games
              .filter((game) => filter === "all" || (filter === "ready" ? !game.projection.blocked.is_blocked : game.projection.blocked.is_blocked))
              .sort((a, b) => sortBy === "total" ? ((b.projection.projected_total ?? -1) - (a.projection.projected_total ?? -1)) : 0)
              .map((game) => {
            const favoriteLabel = buildFavoriteLabel(game);
            const marginLabel = buildProjectedMarginLabel(game);
            const totalLabel = game.projection.projected_total === null ? null : `Total ${game.projection.projected_total.toFixed(1)}`;
            const averageTotalLabel = buildAverageTotalLabel(game);
            const completenessLabel = `${Math.round(game.completeness_score * 100)}% inputs`;

            return (
              <article className={`projection-match is-clickable ${game.projection.blocked.is_blocked ? "blocked" : "ready"}`} key={game.game_id}>
                <button
                  aria-label={buildGameDetailButtonLabel(game)}
                  className="detail-hitarea"
                  type="button"
                  onClick={() => {
                    onOpenGameDetail(game.game_id);
                  }}
                />
                <div className="projection-match-header">
                  <div className="projection-match-heading">
                    <p className={`projection-match-kicker ${game.projection.blocked.is_blocked ? "blocked" : "ready"}`}>{game.projection.blocked.is_blocked ? "Projection blocked" : "Projection ready"}</p>
                    <h3>{game.away_team.full_name} at {game.home_team.full_name}</h3>
                  </div>
                  <div className="projection-match-meta">
                    <span>{formatScheduledStart(game.scheduled_start)}</span>
                    <span>{formatStatusLabel(game.status)}</span>
                    <span>{game.venue_name ?? "Venue pending"}</span>
                  </div>
                </div>

                {game.projection.blocked.is_blocked ? (
                  <div className="projection-match-blocked">
                    <div className="projection-match-copy">
                      <p className="projection-match-note">{buildStarterLine(game)}</p>
                      <p className="projection-match-subnote">{buildAvailabilityLine(game)}</p>
                    </div>
                    <div className="projection-chip-row">
                      <span className="signal-chip signal-chip-neutral">{completenessLabel}</span>
                    </div>
                  </div>
                ) : (
                  <div className="projection-match-body">
                    <div className="projection-scoreline">
                      <div className="projection-score-team">
                        <span>{game.away_team.abbreviation}</span>
                        <strong>{formatProjectedRuns(game.projection.projected_away_runs)}</strong>
                      </div>
                      <div className="projection-score-divider">proj</div>
                      <div className="projection-score-team">
                        <span>{game.home_team.abbreviation}</span>
                        <strong>{formatProjectedRuns(game.projection.projected_home_runs)}</strong>
                      </div>
                    </div>
                    <div className="projection-match-copy">
                      <div className="projection-chip-row">
                        {favoriteLabel ? <span className="signal-chip signal-chip-primary">{favoriteLabel}</span> : null}
                        {marginLabel ? <span className="signal-chip signal-chip-neutral">{marginLabel}</span> : null}
                        {totalLabel ? <span className="signal-chip signal-chip-neutral">{totalLabel}</span> : null}
                        {averageTotalLabel ? <span className="signal-chip signal-chip-neutral">{averageTotalLabel}</span> : null}
                      </div>
                      <p className="projection-match-note">{buildStarterLine(game)}</p>
                      <p className="projection-match-subnote">{buildAvailabilityLine(game)}</p>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
      </>
    ) : null}
  </section>
  );
};

const PlayerCardGrid = ({ players }: { players: PlayerBoardPayload["players"] }) => (
  <div className="player-card-grid">
    {players.map((player) => (
      <article className={`player-card ${player.projection.blocked.is_blocked ? "held" : "ready"}`} key={`${player.player_id}::${player.game_id}`}>
        <div className="player-card-topline">
          <span className={`player-card-badge ${player.projection.blocked.is_blocked ? "held" : "ready"}`}>{formatPlayerProjectionStatus(player)}</span>
          <span className="player-card-timing">{formatScheduledStart(player.scheduled_start)}</span>
        </div>
        <div className="player-card-body">
          <div className="player-card-copy">
            <h3>{player.full_name ?? player.player_id}</h3>
            <p className="player-card-role">{buildPlayerRoleLabel(player)}</p>
            <p className="player-card-note">{buildPlayerStatSummary(player)}</p>
            <p className="player-card-subnote">{buildPlayerDetailSummary(player)}</p>
          </div>
          <div className="player-card-score">
            <span className="player-card-score-kicker">{player.projection.blocked.is_blocked ? "Status" : "Proj pts"}</span>
            <strong>{player.projection.blocked.is_blocked ? "Held" : formatPlayerProjectedPoints(player)}</strong>
            <span className="player-card-score-note">{formatStatusLabel(player.status)}</span>
          </div>
        </div>
        <div className="player-card-footer">
          <span>{player.matchup}</span>
          <span>{player.venue_name ?? "Venue pending"}</span>
        </div>
      </article>
    ))}
  </div>
);

const DfsEdgeCardGrid = ({ players }: { players: readonly DfsEdgeBoardPayload["ready_pitchers"][number][] }) => {
  const buildDfsEdgeNote = (player: DfsEdgeBoardPayload["ready_pitchers"][number]): string => {
    if (!player.draftkings_classic.blocked.is_blocked) {
      return buildPlayerStatSummary(player);
    }

    if (player.projection.fantasy_summary) {
      return `Projected ${formatPlayerProjectedPoints(player)} pts | Waiting on DraftKings Classic salary truth`;
    }

    return "Waiting on DraftKings Classic salary truth for this player row.";
  };

  const buildDfsEdgeDetail = (player: DfsEdgeBoardPayload["ready_pitchers"][number]): string =>
    player.draftkings_classic.blocked.is_blocked ? `${player.matchup} | ${player.venue_name ?? "Venue pending"}` : buildPlayerDetailSummary(player);

  return (
    <div className="player-card-grid">
      {players.map((player) => (
        <article className={`player-card ${player.draftkings_classic.blocked.is_blocked ? "held" : "ready"}`} key={player.player_id}>
          <div className="player-card-topline">
            <span className={`player-card-badge ${player.draftkings_classic.blocked.is_blocked ? "held" : "ready"}`}>{formatDfsEdgeStatus(player)}</span>
            <span className="player-card-timing">{formatScheduledStart(player.scheduled_start)}</span>
          </div>
          <div className="player-card-body">
            <div className="player-card-copy">
              <h3>{player.full_name ?? player.player_id}</h3>
              <p className="player-card-role">{buildPlayerRoleLabel(player)}</p>
              <div className="projection-chip-row">
                <span className="signal-chip signal-chip-primary">{formatDraftKingsClassicSalary(player.draftkings_classic.salary)}</span>
                <span className="signal-chip signal-chip-neutral">{formatDraftKingsClassicValue(player.draftkings_classic.value)}</span>
                {player.draftkings_classic.projected_ownership !== null ? (
                  <span className="signal-chip signal-chip-neutral">
                    {`${(player.draftkings_classic.projected_ownership * 100).toFixed(1)}%${player.draftkings_classic.ownership_source === "placeholder" ? " est." : player.draftkings_classic.ownership_source === "model" ? " mdl" : ""} own`}
                  </span>
                ) : null}
              </div>
              <p className="player-card-note">{buildDfsEdgeNote(player)}</p>
              <p className="player-card-subnote">{buildDfsEdgeDetail(player)}</p>
            </div>
            <div className="player-card-score">
              <span className="player-card-score-kicker">{player.draftkings_classic.blocked.is_blocked ? "Status" : "Proj pts"}</span>
              <strong>{player.draftkings_classic.blocked.is_blocked ? "Held" : formatPlayerProjectedPoints(player)}</strong>
              <span className="player-card-score-note">{player.draftkings_classic.blocked.is_blocked ? "Salary held" : formatDraftKingsClassicValue(player.draftkings_classic.value)}</span>
            </div>
          </div>
          <div className="player-card-footer">
            <span>{player.matchup}</span>
            <span>{player.venue_name ?? "Venue pending"}</span>
          </div>
        </article>
      ))}
    </div>
  );
};

const PlayerProjectionsWorkspace = ({ playerState, playerBoard }: { playerState: PlayerState; playerBoard: PlayerBoardPayload | null }) => {
  const [playerSort, setPlayerSort] = useState<"all" | "highest" | "lowest" | "pitchers" | "batters">("all");
  const populationCopy = buildPlayerBoardPopulationCopy(playerBoard);
  const readyPitchers = getReadyPitchers(playerBoard);
  const readyBatters = getReadyBatters(playerBoard);
  const heldPlayers = getHeldPlayers(playerBoard);
  const topProjectedPlayer = getTopProjectedPlayer(playerBoard);

  return (
    <section className="workspace-panel" role="tabpanel" aria-labelledby="tab-player-projections">
      <div className="workspace-header">
        <div className="workspace-header-copy">
          <p className="workspace-eyebrow">Player Projections</p>
          <h2>Cleared Player Board</h2>
          <p className="workspace-copy">This board shows pitchers and batters from today&apos;s projected matchups. Players appear once their game has a live projection and both lineups are in.</p>
        </div>
        <div className="workspace-pill-stack">
          <span className="workspace-pill">{playerBoard ? formatSourceLabel(playerBoard.source) : "Feed pending"}</span>
          <span className="workspace-pill">{playerBoard ? `${playerBoard.summary.projected_players} player-ready` : "Waiting on players"}</span>
          <span className="workspace-pill">{playerBoard ? `Built ${formatGeneratedStamp(playerBoard.generated_at)}` : "Waiting on update"}</span>
        </div>
      </div>

      <div className="workspace-board-heading">
        <div>
          <span className="workspace-board-kicker">Player board</span>
          <h3 className="workspace-board-title">Today&apos;s Players</h3>
        </div>
        <p className="workspace-board-note">
          {topProjectedPlayer
            ? `${topProjectedPlayer.full_name ?? topProjectedPlayer.player_id} ${formatPlayerProjectedPoints(topProjectedPlayer)} pts top board`
            : "No player-ready rows yet"}
        </p>
      </div>

      {playerState.status === "loading" ? (
        <div className="schedule-state">
          <p className="workspace-eyebrow">Loading</p>
          <h3>Loading player projections</h3>
          <p>The live player board has not landed yet.</p>
        </div>
      ) : null}
      {playerState.status === "error" ? (
        <div className="schedule-state schedule-state-error" role="alert">
          <p className="workspace-eyebrow">Feed Error</p>
          <h3>The player board could not be rendered.</h3>
          <p>{playerState.error}</p>
        </div>
      ) : null}
      {playerState.status === "empty" ? (
        <div className="schedule-state">
          <p className="workspace-eyebrow">No Board</p>
          <h3>Player board hasn&apos;t populated yet.</h3>
          <p>{playerState.note ?? playerBoard?.note ?? "This board fills once projected matchups have cleared into live player rows."}</p>
        </div>
      ) : null}

      {playerState.status === "success" && playerBoard ? (
        <>
          <div className="board-controls">
            <span className="board-controls-label">View</span>
            {(["all", "pitchers", "batters", "highest", "lowest"] as const).map((s) => (
              <button
                key={s}
                className={`board-control-btn ${playerSort === s ? "active" : ""}`}
                type="button"
                onClick={() => { setPlayerSort(s); }}
              >
                {s === "all" ? "All" : s === "pitchers" ? "Pitchers" : s === "batters" ? "Batters" : s === "highest" ? "Highest Pts" : "Lowest Pts"}
              </button>
            ))}
          </div>
          <div className="projection-board">
            <div className="projection-board-title">Today&apos;s Player Board</div>
            <div className="projection-summary-strip">
              <span>{playerBoard.summary.total_players} players</span>
              <span>{playerBoard.summary.projected_players} player-ready</span>
              <span>{playerBoard.summary.blocked_players} held</span>
              <span>{readyPitchers.length} pitchers</span>
              <span>{readyBatters.length} bats</span>
              <span>{playerBoard.summary.games_covered} games</span>
            </div>
            <BoardPopulationNote copy={populationCopy} />
            <div className="projection-match-list">
              {playerSort === "all" ? (
                <>
                  <div className="projection-roster-group">
                    <div className="projection-roster-header">
                      <strong>Pitchers</strong>
                      <span>{readyPitchers.length} ready</span>
                    </div>
                    {readyPitchers.length > 0 ? (
                      <PlayerCardGrid players={readyPitchers} />
                    ) : (
                      <p className="projection-roster-empty">No pitchers have cleared from today&apos;s projected matchups yet.</p>
                    )}
                  </div>
                  <div className="projection-roster-group">
                    <div className="projection-roster-header">
                      <strong>Batters</strong>
                      <span>{readyBatters.length} ready</span>
                    </div>
                    {readyBatters.length > 0 ? (
                      <PlayerCardGrid players={readyBatters} />
                    ) : (
                      <p className="projection-roster-empty">No batters have cleared from today&apos;s projected matchups yet.</p>
                    )}
                  </div>
                  {heldPlayers.length > 0 ? (
                    <div className="projection-roster-group held">
                      <div className="projection-roster-header">
                        <strong>Held</strong>
                        <span>{heldPlayers.length} waiting on projection</span>
                      </div>
                      <PlayerCardGrid players={heldPlayers} />
                    </div>
                  ) : null}
                </>
              ) : playerSort === "pitchers" ? (
                <div className="projection-roster-group">
                  <div className="projection-roster-header">
                    <strong>Pitchers</strong>
                    <span>{readyPitchers.length} ready</span>
                  </div>
                  {readyPitchers.length > 0 ? (
                    <PlayerCardGrid players={readyPitchers} />
                  ) : (
                    <p className="projection-roster-empty">No pitchers have cleared from today&apos;s projected matchups yet.</p>
                  )}
                </div>
              ) : playerSort === "batters" ? (
                <div className="projection-roster-group">
                  <div className="projection-roster-header">
                    <strong>Batters</strong>
                    <span>{readyBatters.length} ready</span>
                  </div>
                  {readyBatters.length > 0 ? (
                    <PlayerCardGrid players={readyBatters} />
                  ) : (
                    <p className="projection-roster-empty">No batters have cleared from today&apos;s projected matchups yet.</p>
                  )}
                </div>
              ) : (
                // highest or lowest — flat sorted list of all ready players
                <div className="projection-roster-group">
                  <div className="projection-roster-header">
                    <strong>{playerSort === "highest" ? "Highest Points" : "Lowest Points"}</strong>
                    <span>{readyPitchers.length + readyBatters.length} ready</span>
                  </div>
                  {readyPitchers.length + readyBatters.length > 0 ? (
                    <PlayerCardGrid
                      players={[...readyPitchers, ...readyBatters].sort((a, b) => {
                        const apts = getPlayerProjectedPoints(a) ?? (playerSort === "highest" ? -Infinity : Infinity);
                        const bpts = getPlayerProjectedPoints(b) ?? (playerSort === "highest" ? -Infinity : Infinity);
                        return playerSort === "highest" ? bpts - apts : apts - bpts;
                      })}
                    />
                  ) : (
                    <p className="projection-roster-empty">No ready players on today&apos;s board yet.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
};

const DfsEdgeWorkspace = ({ dfsState, dfsBoard }: { dfsState: DfsState; dfsBoard: DfsEdgeBoardPayload | null }) => {
  const [dfsSort, setDfsSort] = useState<"default" | "value" | "points" | "salary">("default");
  const populationCopy = buildDfsBoardPopulationCopy(dfsBoard);

  const sortDfsPlayers = (
    players: readonly DfsEdgeBoardPayload["ready_pitchers"][number][]
  ): readonly DfsEdgeBoardPayload["ready_pitchers"][number][] => {
    if (dfsSort === "default") return players;
    return [...players].sort((a, b) => {
      if (dfsSort === "value") return (b.draftkings_classic.value ?? -1) - (a.draftkings_classic.value ?? -1);
      if (dfsSort === "points") return (b.projection.fantasy_summary?.projected_points ?? -1) - (a.projection.fantasy_summary?.projected_points ?? -1);
      if (dfsSort === "salary") return (b.draftkings_classic.salary ?? -1) - (a.draftkings_classic.salary ?? -1);
      return 0;
    });
  };

  return (
    <section className="workspace-panel" role="tabpanel" aria-labelledby="tab-dfs-edge">
      <div className="workspace-header">
        <div className="workspace-header-copy">
          <p className="workspace-eyebrow">DFS Edge</p>
          <h2>DraftKings Classic</h2>
          <p className="workspace-copy">
            This board only uses reconciled player projections plus live DraftKings Classic salary truth. It surfaces projected points, salary, and derived value without ownership, optimizer, or lineup-builder claims.
          </p>
        </div>
        <div className="workspace-pill-stack">
          <span className="workspace-pill">DraftKings Classic</span>
          <span className="workspace-pill">{dfsBoard?.draftkings_classic?.label ?? "Slate pending"}</span>
          <span className="workspace-pill">{dfsBoard ? `Built ${formatGeneratedStamp(dfsBoard.generated_at)}` : "Waiting on update"}</span>
        </div>
      </div>

      <div className="workspace-board-heading">
        <div>
          <span className="workspace-board-kicker">DFS board</span>
          <h3 className="workspace-board-title">DraftKings Classic Edge</h3>
        </div>
        <p className="workspace-board-note">{dfsBoard?.summary.top_value_player ? `${dfsBoard.summary.top_value_player.full_name} ${dfsBoard.summary.top_value_player.value.toFixed(2)} pts/$1k top value` : "No DraftKings-ready rows yet"}</p>
      </div>

      {dfsState.status === "loading" ? (
        <div className="schedule-state">
          <p className="workspace-eyebrow">Loading</p>
          <h3>Loading DraftKings Classic edge</h3>
          <p>The DFS board has not landed yet.</p>
        </div>
      ) : null}
      {dfsState.status === "error" ? (
        <div className="schedule-state schedule-state-error" role="alert">
          <p className="workspace-eyebrow">Feed Error</p>
          <h3>The DFS board could not be rendered.</h3>
          <p>{dfsState.error}</p>
        </div>
      ) : null}
      {dfsState.status === "empty" ? (
        <div className="schedule-state">
          <p className="workspace-eyebrow">No Board</p>
          <h3>No DraftKings Classic rows yet.</h3>
          <p>{dfsState.note ?? dfsBoard?.note ?? "This board fills once player rows have a live DraftKings Classic salary."}</p>
        </div>
      ) : null}

      {dfsState.status === "success" && dfsBoard ? (
        <>
          <div className="board-controls">
            <span className="board-controls-label">Sort</span>
            {(["default", "value", "points", "salary"] as const).map((s) => (
              <button
                key={s}
                className={`board-control-btn ${dfsSort === s ? "active" : ""}`}
                type="button"
                onClick={() => { setDfsSort(s); }}
              >
                {s === "default" ? "Default" : s === "value" ? "By Value" : s === "points" ? "By Points" : "By Salary"}
              </button>
            ))}
          </div>
          <div className="projection-board">
            <div className="projection-board-title">DraftKings Classic Board</div>
            <div className="projection-summary-strip">
              <span>{dfsBoard.summary.ready_players} DraftKings-ready</span>
              <span>{dfsBoard.summary.held_players} held</span>
              <span>{dfsBoard.summary.ready_pitchers} pitchers</span>
              <span>{dfsBoard.summary.ready_batters} bats</span>
              <span>{dfsBoard.summary.average_ready_salary === null ? "No avg salary" : `Avg salary ${formatDraftKingsClassicSalary(Math.round(dfsBoard.summary.average_ready_salary))}`}</span>
              <span>{dfsBoard.summary.average_ready_value === null ? "No avg value" : `Avg value ${formatDraftKingsClassicValue(dfsBoard.summary.average_ready_value)}`}</span>
            </div>
            <BoardPopulationNote copy={populationCopy} />
            <div className="projection-match-list">
              <div className="projection-roster-group">
                <div className="projection-roster-header">
                  <strong>Pitchers</strong>
                  <span>{dfsBoard.summary.ready_pitchers} DraftKings-ready</span>
                </div>
                {dfsBoard.ready_pitchers.length > 0 ? (
                  <DfsEdgeCardGrid players={sortDfsPlayers(dfsBoard.ready_pitchers)} />
                ) : (
                  <p className="projection-roster-empty">No pitchers have both a projection and a DraftKings Classic salary yet.</p>
                )}
              </div>
              <div className="projection-roster-group">
                <div className="projection-roster-header">
                  <strong>Batters</strong>
                  <span>{dfsBoard.summary.ready_batters} DraftKings-ready</span>
                </div>
                {dfsBoard.ready_batters.length > 0 ? (
                  <DfsEdgeCardGrid players={sortDfsPlayers(dfsBoard.ready_batters)} />
                ) : (
                  <p className="projection-roster-empty">No batters have both a projection and a DraftKings Classic salary yet.</p>
                )}
              </div>
              {dfsBoard.held_players.length > 0 ? (
                <div className="projection-roster-group held">
                  <div className="projection-roster-header">
                    <strong>Held</strong>
                    <span>{dfsBoard.held_players.length} waiting on DraftKings Classic salary</span>
                  </div>
                  <DfsEdgeCardGrid players={dfsBoard.held_players} />
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
};

const BettingEdgeMatchList = ({ games }: { games: readonly BettingEdgeBoardPayload["ready_games"][number][] }) => (
  <div className="projection-match-list">
    {games.map((game) => {
      const leader = getBettingEdgeLeader(game);
      const isHeld = game.draftkings_sportsbook_moneyline.blocked.is_blocked;
      const edgeLine =
        leader.market_odds_american === null || leader.model_probability === null
          ? "Moneyline edge is pending."
          : `${leader.team_abbreviation} ${formatAmericanOdds(leader.market_odds_american)} | Model ${formatBettingEdgeProbability(leader.model_probability)} | ${formatBettingEdgePercent(leader.edge)}`;
      const fairLine = `${game.away_team_abbreviation} ${formatFairAmericanOdds(game.draftkings_sportsbook_moneyline.away.fair_american_odds)} | ${game.home_team_abbreviation} ${formatFairAmericanOdds(
        game.draftkings_sportsbook_moneyline.home.fair_american_odds,
      )}`;
      const probabilityLine = `${game.away_team_abbreviation} ${formatBettingEdgeProbability(game.draftkings_sportsbook_moneyline.away.model_probability)} model | ${game.home_team_abbreviation} ${formatBettingEdgeProbability(
        game.draftkings_sportsbook_moneyline.home.model_probability,
      )} model`;
      const heldLine = game.projection.blocked.is_blocked ? "Projection chain is still held for this matchup." : "DraftKings Sportsbook did not return one clean pregame moneyline for this matchup.";

      return (
        <article className={`projection-match ${isHeld ? "blocked" : "ready"}`} key={game.game_id}>
          <div className="projection-match-header">
            <div className="projection-match-heading">
              <p className={`projection-match-kicker ${isHeld ? "blocked" : "ready"}`}>{formatBettingEdgeStatus(game)}</p>
              <h3>{game.matchup}</h3>
            </div>
            <div className="projection-match-meta">
              <span>{formatScheduledStart(game.scheduled_start)}</span>
              <span>{formatStatusLabel(game.status)}</span>
              <span>{game.venue_name ?? "Venue pending"}</span>
            </div>
          </div>

          {isHeld ? (
            <div className="projection-match-blocked">
              <div className="projection-match-copy">
                <p className="projection-match-note">{heldLine}</p>
                <p className="projection-match-subnote">
                  {game.matchup} | {game.venue_name ?? "Venue pending"}
                </p>
              </div>
              <div className="projection-chip-row">
                <span className="signal-chip signal-chip-neutral">Held</span>
              </div>
            </div>
          ) : (
            <div className="projection-match-body">
              <div className="projection-scoreline">
                <div className="projection-score-team">
                  <span>{game.away_team_abbreviation}</span>
                  <strong>{formatAmericanOdds(game.draftkings_sportsbook_moneyline.away.market_odds_american)}</strong>
                </div>
                <div className="projection-score-divider">ml</div>
                <div className="projection-score-team">
                  <span>{game.home_team_abbreviation}</span>
                  <strong>{formatAmericanOdds(game.draftkings_sportsbook_moneyline.home.market_odds_american)}</strong>
                </div>
              </div>
              <div className="projection-match-copy">
                <div className="projection-chip-row">
                  <span className="signal-chip signal-chip-primary">
                    {leader.team_abbreviation} {formatBettingEdgePercent(leader.edge)}
                  </span>
                  <span className="signal-chip signal-chip-neutral">DraftKings Sportsbook</span>
                  <span className="signal-chip signal-chip-neutral">MLB pregame moneyline</span>
                </div>
                <p className="projection-match-note">{edgeLine}</p>
                <p className="projection-match-subnote">
                  {probabilityLine} | {fairLine}
                </p>
              </div>
            </div>
          )}
        </article>
      );
    })}
  </div>
);

const BettingEdgeWorkspace = ({ bettingState, bettingBoard }: { bettingState: BettingState; bettingBoard: BettingEdgeBoardPayload | null }) => {
  const [bettingSort, setBettingSort] = useState<"default" | "edge" | "start">("default");
  const populationCopy = buildBettingBoardPopulationCopy(bettingBoard);

  const sortBettingGames = (
    games: readonly BettingEdgeBoardPayload["ready_games"][number][]
  ): readonly BettingEdgeBoardPayload["ready_games"][number][] => {
    if (bettingSort === "default") return games;
    return [...games].sort((a, b) => {
      if (bettingSort === "edge") {
        const aLeader = getBettingEdgeLeader(a);
        const bLeader = getBettingEdgeLeader(b);
        return (bLeader.edge ?? -Infinity) - (aLeader.edge ?? -Infinity);
      }
      if (bettingSort === "start") return a.scheduled_start.localeCompare(b.scheduled_start);
      return 0;
    });
  };

  return (
    <section className="workspace-panel" role="tabpanel" aria-labelledby="tab-betting-edge">
      <div className="workspace-header">
        <div className="workspace-header-copy">
          <p className="workspace-eyebrow">Betting Edge</p>
          <h2>DraftKings Sportsbook</h2>
          <p className="workspace-copy">
            This board only uses projection-ready game rows plus DraftKings Sportsbook MLB pregame moneyline truth (live feed or stored snapshot). It surfaces one-book moneyline odds and derived edge without totals, props, or multi-book comparison.
          </p>
        </div>
        <div className="workspace-pill-stack">
          <span className="workspace-pill">DraftKings Sportsbook</span>
          <span className="workspace-pill">{bettingBoard?.draftkings_sportsbook_moneyline?.label ?? "Slate pending"}</span>
          <span className="workspace-pill">{bettingBoard ? `Built ${formatGeneratedStamp(bettingBoard.generated_at)}` : "Waiting on update"}</span>
        </div>
      </div>

      <div className="workspace-board-heading">
        <div>
          <span className="workspace-board-kicker">Betting board</span>
          <h3 className="workspace-board-title">MLB Pregame Moneyline</h3>
        </div>
        <p className="workspace-board-note">
          {bettingBoard?.summary.top_edge_side ? `${bettingBoard.summary.top_edge_side.team_abbreviation} ${formatBettingEdgePercent(bettingBoard.summary.top_edge_side.edge)} top edge` : "No moneyline-ready rows yet"}
        </p>
      </div>

      {bettingState.status === "loading" ? (
        <div className="schedule-state">
          <p className="workspace-eyebrow">Loading</p>
          <h3>Loading DraftKings Sportsbook moneyline edge</h3>
          <p>The betting board has not landed yet.</p>
        </div>
      ) : null}
      {bettingState.status === "error" ? (
        <div className="schedule-state schedule-state-error" role="alert">
          <p className="workspace-eyebrow">Feed Error</p>
          <h3>The betting board could not be rendered.</h3>
          <p>{bettingState.error}</p>
        </div>
      ) : null}
      {bettingState.status === "empty" ? (
        <div className="schedule-state">
          <p className="workspace-eyebrow">No Board</p>
          <h3>No moneyline-ready matchups yet.</h3>
          <p>{bettingState.note ?? bettingBoard?.note ?? "This board fills once projected matchups have a DraftKings Sportsbook pregame moneyline."}</p>
        </div>
      ) : null}

      {bettingState.status === "success" && bettingBoard ? (
        <>
          <div className="board-controls">
            <span className="board-controls-label">Sort</span>
            {(["default", "edge", "start"] as const).map((s) => (
              <button
                key={s}
                className={`board-control-btn ${bettingSort === s ? "active" : ""}`}
                type="button"
                onClick={() => { setBettingSort(s); }}
              >
                {s === "default" ? "Default" : s === "edge" ? "Highest Edge" : "Earliest Game"}
              </button>
            ))}
          </div>
          <div className="projection-board">
            <div className="projection-board-title">DraftKings Sportsbook Moneyline Board</div>
            <div className="projection-summary-strip">
              <span>{bettingBoard.summary.ready_games} moneyline-ready</span>
              <span>{bettingBoard.summary.held_games} held</span>
              <span>{bettingBoard.counts.matched_markets} matched markets</span>
              <span>{bettingBoard.summary.average_ready_edge === null ? "No ready average" : `Avg ${formatBettingEdgePercent(bettingBoard.summary.average_ready_edge)}`}</span>
              <span>{bettingBoard.summary.top_edge_side ? `${bettingBoard.summary.top_edge_side.team_abbreviation} ${formatAmericanOdds(bettingBoard.summary.top_edge_side.market_odds_american)}` : "No top side yet"}</span>
            </div>
            <BoardPopulationNote copy={populationCopy} />
            <div className="projection-match-list">
              <div className="projection-roster-group">
                <div className="projection-roster-header">
                  <strong>Moneyline-ready</strong>
                  <span>{bettingBoard.summary.ready_games} ready</span>
                </div>
                {bettingBoard.ready_games.length > 0 ? (
                  <BettingEdgeMatchList games={sortBettingGames(bettingBoard.ready_games)} />
                ) : (
<p className="projection-roster-empty">No projected matchup has a DraftKings Sportsbook pregame moneyline yet.</p>
                )}
              </div>

              {bettingBoard.held_games.length > 0 ? (
                <div className="projection-roster-group held">
                  <div className="projection-roster-header">
                    <strong>Held</strong>
                    <span>{bettingBoard.held_games.length} waiting on DraftKings Sportsbook moneyline</span>
                  </div>
                  <BettingEdgeMatchList games={bettingBoard.held_games} />
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
};

const SmokeSignalWorkspace = ({
  smokeSignalState,
  smokeSignal,
}: {
  smokeSignalState: SmokeSignalState;
  smokeSignal: SmokeSignalPayload | null;
}) => {
  return (
    <section className="workspace-panel" role="tabpanel" aria-labelledby="tab-smoke-signal">
      <div className="workspace-header">
        <div className="workspace-header-copy">
          <p className="workspace-eyebrow">Smoke Signal</p>
          <h2>Canonical highlight board</h2>
          <p className="workspace-copy">
            This tab reads the typed Smoke Signal payload published by the canonical snapshot. It does not recompute schedule, player, DFS, betting, or live state in the shell.
          </p>
        </div>
        <div className="workspace-pill-stack">
          <span className="workspace-pill">Smoke Signal v1</span>
          <span className="workspace-pill">{smokeSignal ? `${smokeSignal.summary.ready_signals}/${smokeSignal.summary.total_sections_considered} live` : "Waiting on signal"}</span>
          <span className="workspace-pill">{smokeSignal ? `Built ${formatGeneratedStamp(smokeSignal.generated_at)}` : "Waiting on update"}</span>
        </div>
      </div>

      <div className="workspace-board-heading">
        <div>
          <span className="workspace-board-kicker">Highlight board</span>
          <h3 className="workspace-board-title">Smoke Signal</h3>
        </div>
        <p className="workspace-board-note">{smokeSignalState.note ?? smokeSignal?.note ?? "Canonical highlights only."}</p>
      </div>

      {smokeSignalState.status === "loading" ? (
        <div className="schedule-state">
          <p className="workspace-eyebrow">Loading</p>
          <h3>Loading Smoke Signal</h3>
          <p>The shell is waiting on the canonical highlight board.</p>
        </div>
      ) : null}
      {smokeSignalState.status === "error" ? (
        <div className="schedule-state schedule-state-error" role="alert">
          <p className="workspace-eyebrow">Feed Error</p>
          <h3>The Smoke Signal board could not be rendered.</h3>
          <p>{smokeSignalState.error}</p>
        </div>
      ) : null}
      {smokeSignalState.status === "empty" ? (
        <div className="schedule-state">
          <p className="workspace-eyebrow">No Board</p>
          <h3>No Smoke Signal highlights are ready yet.</h3>
          <p>{smokeSignalState.note ?? smokeSignal?.note ?? "The snapshot is live, but no Smoke Signal slots are available yet."}</p>
        </div>
      ) : null}

      {smokeSignalState.status === "success" && smokeSignal ? (
        <div className="projection-board">
          <div className="projection-board-title">Smoke Signal v1</div>
          <div className="projection-summary-strip">
            <span>{smokeSignal.summary.ready_signals} highlights live</span>
            <span>{smokeSignal.summary.blocked_signals} unavailable</span>
            <span>{smokeSignal.overview.total_games} games</span>
            <span>{smokeSignal.overview.projection_ready_games} projection-ready</span>
            <span>{smokeSignal.live_pulse ? `${smokeSignal.live_pulse.live_games} live` : "No live pulse"}</span>
          </div>
          {smokeSignal.note ? (
            <div className="board-state-note">
              <strong>Fallback state</strong>
              <p>{smokeSignal.note}</p>
            </div>
          ) : null}
          <div className="projection-match-list">
            <div className="projection-roster-group">
              <div className="projection-roster-header">
                <strong>Highlights</strong>
                <span>{smokeSignal.summary.ready_signals} ready</span>
              </div>
              <div className="smoke-signal-grid">
                <SmokeSignalCard
                  eyebrow="Top Projected Total"
                  title={smokeSignal.top_projected_total_game?.matchup ?? "Unavailable"}
                  body={formatSmokeSignalTotal(smokeSignal.top_projected_total_game)}
                  blocked={smokeSignal.top_projected_total_game === null}
                />
                <SmokeSignalCard
                  eyebrow="Top Projected Player"
                  title={smokeSignal.top_projected_player?.full_name ?? "Unavailable"}
                  body={formatSmokeSignalPlayer(smokeSignal.top_projected_player)}
                  blocked={smokeSignal.top_projected_player === null}
                />
                <SmokeSignalCard
                  eyebrow="Top DFS Value"
                  title={smokeSignal.top_dfs_value_player?.full_name ?? "Unavailable"}
                  body={formatSmokeSignalDfs(smokeSignal.top_dfs_value_player)}
                  blocked={smokeSignal.top_dfs_value_player === null}
                />
                <SmokeSignalCard
                  eyebrow="Top Betting Edge"
                  title={smokeSignal.top_betting_edge_side?.matchup ?? "Unavailable"}
                  body={formatSmokeSignalBetting(smokeSignal.top_betting_edge_side)}
                  blocked={smokeSignal.top_betting_edge_side === null}
                />
                <SmokeSignalCard
                  eyebrow="Live Pulse"
                  title={smokeSignal.live_pulse ? "Live slate pulse" : "Unavailable"}
                  body={formatSmokeSignalPulse(smokeSignal.live_pulse)}
                  blocked={smokeSignal.live_pulse === null}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};

export function MlbDashboardShell() {
  const [activeTab, setActiveTab] = useState<DashboardTabId>("schedule");
  const [selectedGameId, setSelectedGameId] = useState<ScheduleBoardPayload["games"][number]["game_id"] | null>(null);
  const [scheduleState, setScheduleState] = useState<ScheduleState>(INITIAL_SCHEDULE_STATE);
  const [playerState, setPlayerState] = useState<PlayerState>(INITIAL_PLAYER_STATE);
  const [dfsState, setDfsState] = useState<DfsState>(INITIAL_DFS_STATE);
  const [bettingState, setBettingState] = useState<BettingState>(INITIAL_BETTING_STATE);
  const [liveScoreboardState, setLiveScoreboardState] = useState<LiveScoreboardState>(INITIAL_LIVE_SCOREBOARD_STATE);
  const [smokeSignalState, setSmokeSignalState] = useState<SmokeSignalState>(INITIAL_SMOKE_SIGNAL_STATE);

  const scheduleBoard = scheduleState.board;
  const summary = scheduleBoard?.summary ?? EMPTY_SCHEDULE_SUMMARY;
  const playerBoard = playerState.board;
  const dfsBoard = dfsState.board;
  const bettingBoard = bettingState.board;
  const liveScoreboard = liveScoreboardState.board;
  const smokeSignal = smokeSignalState.board;
  const selectedGame = selectedGameId === null ? null : (scheduleBoard?.games.find((game) => game.game_id === selectedGameId) ?? null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadSnapshot = async (): Promise<void> => {
      try {
        const response = await fetch(SNAPSHOT_ROUTE, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as unknown;

        if (!response.ok) {
          throw new Error(readResponseError(payload) ?? `Snapshot request failed with status ${response.status}.`);
        }

        const snapshot = parseSlateSnapshotPayload(payload);
        const parsedScheduleBoard = snapshot.schedule.payload;
        const parsedPlayerBoard = snapshot.player_projections.payload;
        const parsedDfsBoard = snapshot.dfs_edge.payload;
        const parsedBettingBoard = snapshot.betting_edge.payload;
        const parsedLiveScoreboard = snapshot.live_scoreboard.payload;
        const parsedSmokeSignal = snapshot.smoke_signal.payload;

        if (parsedScheduleBoard === null || parsedPlayerBoard === null) {
          throw new Error("Snapshot is missing a required schedule or player section.");
        }

        const dfsRows =
          parsedDfsBoard === null
            ? 0
            : parsedDfsBoard.ready_pitchers.length + parsedDfsBoard.ready_batters.length + parsedDfsBoard.held_players.length;
        const bettingRows =
          parsedBettingBoard === null
            ? 0
            : parsedBettingBoard.ready_games.length + parsedBettingBoard.held_games.length;
        const liveScoreboardRows =
          parsedLiveScoreboard === null ? 0 : parsedLiveScoreboard.games.length;
        const smokeSignalRows =
          parsedSmokeSignal === null ? 0 : parsedSmokeSignal.summary.ready_signals;

        if (!cancelled) {
          setScheduleState({
            status: parsedScheduleBoard.games.length === 0 ? "empty" : "success",
            board: parsedScheduleBoard,
            error: null,
            note: snapshot.schedule.status.reason ?? parsedScheduleBoard.note,
          });
          setPlayerState({
            status: parsedPlayerBoard.players.length === 0 ? "empty" : "success",
            board: parsedPlayerBoard,
            error: null,
            note: snapshot.player_projections.status.reason ?? parsedPlayerBoard.note,
          });
          setDfsState({
            status: dfsRows === 0 ? "empty" : "success",
            board: parsedDfsBoard,
            error: null,
            note: snapshot.dfs_edge.status.reason ?? parsedDfsBoard?.note ?? null,
          });
          setBettingState({
            status: bettingRows === 0 ? "empty" : "success",
            board: parsedBettingBoard,
            error: null,
            note: snapshot.betting_edge.status.reason ?? parsedBettingBoard?.note ?? null,
          });
          setLiveScoreboardState({
            status: liveScoreboardRows === 0 ? "empty" : "success",
            board: parsedLiveScoreboard,
            error: null,
            note: snapshot.live_scoreboard.status.reason ?? parsedLiveScoreboard?.note ?? null,
          });
          setSmokeSignalState({
            status: smokeSignalRows === 0 ? "empty" : "success",
            board: parsedSmokeSignal,
            error: null,
            note: snapshot.smoke_signal.status.reason ?? parsedSmokeSignal?.note ?? null,
          });
        }
      } catch (error) {
        if (!cancelled && !(error instanceof Error && error.name === "AbortError")) {
          const errorMessage = getErrorMessage(error);
          setScheduleState({
            status: "error",
            board: null,
            error: errorMessage,
            note: null,
          });
          setPlayerState({
            status: "error",
            board: null,
            error: errorMessage,
            note: null,
          });
          setDfsState({
            status: "error",
            board: null,
            error: errorMessage,
            note: null,
          });
          setBettingState({
            status: "error",
            board: null,
            error: errorMessage,
            note: null,
          });
          setLiveScoreboardState({
            status: "error",
            board: null,
            error: errorMessage,
            note: null,
          });
          setSmokeSignalState({
            status: "error",
            board: null,
            error: errorMessage,
            note: null,
          });
        }
      }
    };

    loadSnapshot().catch((error: unknown) => {
      if (!cancelled) {
        const errorMessage = getErrorMessage(error);
        setScheduleState({
          status: "error",
          board: null,
          error: errorMessage,
          note: null,
        });
        setPlayerState({
          status: "error",
          board: null,
          error: errorMessage,
          note: null,
        });
        setDfsState({
          status: "error",
          board: null,
          error: errorMessage,
          note: null,
        });
        setBettingState({
          status: "error",
          board: null,
          error: errorMessage,
          note: null,
        });
        setLiveScoreboardState({
          status: "error",
          board: null,
          error: errorMessage,
          note: null,
        });
        setSmokeSignalState({
          status: "error",
          board: null,
          error: errorMessage,
          note: null,
        });
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!selectedGameId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedGameId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedGameId]);

  useEffect(() => {
    if (selectedGameId && !selectedGame) {
      setSelectedGameId(null);
    }
  }, [selectedGame, selectedGameId]);

  return (
    <main className="dashboard-page">
      <div className="dashboard-grid">
        <StatusRail
          scheduleBoard={scheduleBoard}
          liveScoreboardState={liveScoreboardState}
          liveScoreboard={liveScoreboard}
          summary={summary}
          onOpenGameDetail={setSelectedGameId}
        />

        <section className="dashboard-main">
          <header className="hero-stage">
            <div className="hero-copy-block">
              <p className="hero-overline">Southern Smokey Studio</p>
              <h1>MLB Projection Dashboard</h1>
              <p>Schedule, game projections, player projections, DFS Edge, and Betting Edge — all from the same live feed.</p>
            </div>

            <div className="hero-figure">
              <div className="hero-figure-card">
                <span className="hero-figure-kicker">Today&apos;s board</span>
                <strong>{summary.total_games === 0 ? "Waiting on the live feed." : `${summary.total_games} games today`}</strong>
                <p>
                  {summary.total_games === 0
                    ? "The feed is up. No games have loaded yet."
                    : `${summary.projection_ready_games} projection-ready · ${summary.games_ready_for_player_projections} player-ready · ${summary.blocked_games} held`}
                </p>
              </div>
              <div className="hero-figure-footer">
                <span>{scheduleBoard ? formatSourceLabel(scheduleBoard.source) : "Feed pending"}</span>
                <span>{scheduleBoard ? `Built ${formatGeneratedStamp(scheduleBoard.generated_at)}` : "Waiting on update"}</span>
              </div>
            </div>
          </header>

          <div className="dashboard-tabbar" role="tablist" aria-label="MLB dashboard tabs">
            {DASHBOARD_TABS.map((tab) => (
              <button
                key={tab.id}
                className={`dashboard-tab ${activeTab === tab.id ? "active" : ""}`}
                id={`tab-${tab.id}`}
                role="tab"
                type="button"
                aria-selected={activeTab === tab.id}
                aria-controls={`panel-${tab.id}`}
                onClick={() => {
                  startTransition(() => {
                    setActiveTab(tab.id);
                  });
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="dashboard-stage" id={`panel-${activeTab}`}>
            {activeTab === "schedule" ? (
              <ScheduleWorkspace scheduleState={scheduleState} scheduleBoard={scheduleBoard} summary={summary} onOpenGameDetail={setSelectedGameId} />
            ) : activeTab === "game-projections" ? (
              <GameProjectionsWorkspace scheduleState={scheduleState} scheduleBoard={scheduleBoard} onOpenGameDetail={setSelectedGameId} />
            ) : activeTab === "player-projections" ? (
              <PlayerProjectionsWorkspace playerState={playerState} playerBoard={playerBoard} />
            ) : activeTab === "dfs-edge" ? (
              <DfsEdgeWorkspace dfsState={dfsState} dfsBoard={dfsBoard} />
            ) : activeTab === "betting-edge" ? (
              <BettingEdgeWorkspace bettingState={bettingState} bettingBoard={bettingBoard} />
            ) : (
              <SmokeSignalWorkspace smokeSignalState={smokeSignalState} smokeSignal={smokeSignal} />
            )}
          </div>
        </section>
      </div>
      {selectedGame ? (
        <GameDetailDrawer
          game={selectedGame}
          onClose={() => {
            setSelectedGameId(null);
          }}
        />
      ) : null}
    </main>
  );
}
