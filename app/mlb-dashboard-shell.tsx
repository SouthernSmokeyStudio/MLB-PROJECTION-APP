"use client";

import Image from "next/image";
import React, { startTransition, useEffect, useState } from "react";
import type { BettingEdgeBoardPayload } from "@lib/contracts/betting-edge-board";
import type { DfsEdgeBoardPayload } from "@lib/contracts/dfs-edge-board";
import type { PlayerBoardPayload } from "@lib/contracts/player-board";
import type { ScheduleBoardPayload, ScheduleBoardSummary } from "@lib/contracts/schedule-board";
import { formatAmericanOdds, formatBettingEdgePercent, formatBettingEdgeProbability, formatBettingEdgeStatus, formatFairAmericanOdds, getBettingEdgeLeader, parseBettingEdgeBoardPayload } from "@lib/betting-edge-board";
import { formatDfsEdgeStatus, formatDraftKingsClassicSalary, formatDraftKingsClassicValue, parseDfsEdgeBoardPayload } from "@lib/dfs-edge-board";
import { buildGameProjectionBoard, formatAverageTotalLabel, formatFavoriteLabel, formatProjectedMarginLabel, formatProjectedRuns, type GameProjectionBoard } from "@lib/game-projection-board";
import { buildPlayerProjectionBoard, type PlayerProjectionBoard } from "@lib/player-projection-board";
import { buildPlayerDetailSummary, buildPlayerRoleLabel, buildPlayerStatSummary, formatPlayerProjectedPoints, formatPlayerProjectionStatus, parsePlayerBoardPayload } from "@lib/player-board";
import {
  EMPTY_SCHEDULE_SUMMARY,
  buildAvailabilityLine,
  buildStarterLine,
  formatBoardDate,
  formatGeneratedStamp,
  formatProjectionEdgeLabel,
  formatProjectedTotalLabel,
  formatProjectionReadyLabel,
  formatScheduledStart,
  formatSourceLabel,
  formatStatusLabel,
  getErrorMessage,
  parseScheduleBoardPayload,
  readResponseError,
} from "@lib/schedule-board";

export const DASHBOARD_TABS = [
  { id: "schedule", label: "Schedule" },
  { id: "game-projections", label: "Game Projections" },
  { id: "player-projections", label: "Player Projections" },
  { id: "dfs-edge", label: "DFS Edge" },
  { id: "betting-edge", label: "Betting Edge" },
  { id: "smoke-signal", label: "Smoke Signal" },
] as const;

type DashboardTabId = (typeof DASHBOARD_TABS)[number]["id"];
type InactiveTabId = Exclude<DashboardTabId, "schedule" | "game-projections" | "player-projections" | "dfs-edge" | "betting-edge">;

interface TabPlaceholder {
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly note: string;
}

interface ScheduleState {
  readonly status: "loading" | "success" | "empty" | "error";
  readonly board: ScheduleBoardPayload | null;
  readonly error: string | null;
}

interface PlayerState {
  readonly status: "loading" | "success" | "empty" | "error";
  readonly board: PlayerBoardPayload | null;
  readonly error: string | null;
}

interface DfsState {
  readonly status: "loading" | "success" | "empty" | "error";
  readonly board: DfsEdgeBoardPayload | null;
  readonly error: string | null;
}

interface BettingState {
  readonly status: "loading" | "success" | "empty" | "error";
  readonly board: BettingEdgeBoardPayload | null;
  readonly error: string | null;
}

const SCHEDULE_ROUTE = "/api/games";
const PLAYER_ROUTE = "/api/players";
const DFS_EDGE_ROUTE = "/api/dfs-edge";
const BETTING_EDGE_ROUTE = "/api/betting-edge";
const LOGO_SRC = "/sss-smokey-studio-logo.jpeg";

export const TAB_PLACEHOLDERS: Record<InactiveTabId, TabPlaceholder> = {
  "smoke-signal": {
    eyebrow: "Blocked",
    title: "Smoke Signal stays off until reviewed signal content is live.",
    body: "The Schedule board is now useful on real route data, but signal content still does not have a truthful live surface here.",
    note: "Current repo truth still does not justify a live signal panel.",
  },
};

const INITIAL_SCHEDULE_STATE: ScheduleState = {
  status: "loading",
  board: null,
  error: null,
};

const INITIAL_PLAYER_STATE: PlayerState = {
  status: "loading",
  board: null,
  error: null,
};

const INITIAL_DFS_STATE: DfsState = {
  status: "loading",
  board: null,
  error: null,
};

const INITIAL_BETTING_STATE: BettingState = {
  status: "loading",
  board: null,
  error: null,
};

interface BoardPopulationCopy {
  readonly title: string;
  readonly body: string;
}

const buildGameDetailButtonLabel = (game: ScheduleBoardPayload["games"][number] | GameProjectionBoard["games"][number]): string => `Open game detail for ${game.away_team.abbreviation} at ${game.home_team.abbreviation}`;

const buildPlayerCarryLine = (game: ScheduleBoardPayload["games"][number]): string =>
  game.player_projection_status === "ready" ? "Player board is live for this matchup." : "Player board is still building for this matchup.";

const buildPlayerBoardPopulationCopy = (board: PlayerProjectionBoard | null): BoardPopulationCopy | null => {
  if (!board) {
    return null;
  }

  if (board.summary.projected_players === 0) {
    return {
      title: "Player board is still building.",
      body: "This board fills once projected matchups have cleared into live player rows.",
    };
  }

  if (board.held_players.length > 0) {
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
      body: "Betting Edge only shows matchups that have a live DraftKings Sportsbook pregame moneyline.",
    };
  }

  if (board.held_games.length > 0) {
    return {
      title: "Some matchups are still waiting on a moneyline.",
      body: "Only matchups with a live DraftKings Sportsbook moneyline appear on the ready side.",
    };
  }

  return null;
};

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
            <strong>Matchup</strong>
            <span>{game.venue_name ?? "Venue pending"}</span>
          </div>
          <div className="game-detail-facts">
            <div className="game-detail-fact">
              <span className="game-detail-fact-label">Starters</span>
              <p className="game-detail-fact-copy">{buildStarterLine(game)}</p>
            </div>
            <div className="game-detail-fact">
              <span className="game-detail-fact-label">Lineup status</span>
              <p className="game-detail-fact-copy">{buildAvailabilityLine(game)}</p>
            </div>
            <div className="game-detail-fact">
              <span className="game-detail-fact-label">Player board</span>
              <p className="game-detail-fact-copy">{buildPlayerCarryLine(game)}</p>
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
              <p className="game-detail-copy">{buildPlayerCarryLine(game)}</p>
            </>
          )}
        </section>
      </aside>
    </div>
  );
};

const StatusRail = ({
  scheduleState,
  scheduleBoard,
  summary,
  onOpenGameDetail,
}: {
  scheduleState: ScheduleState;
  scheduleBoard: ScheduleBoardPayload | null;
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
        <span>First Six</span>
      </div>
      {scheduleState.status === "loading" ? <div className="status-rail-note">Loading today&apos;s board.</div> : null}
      {scheduleState.status === "error" ? <div className="status-rail-note error">The shell is live, but the slate data could not load.</div> : null}
      {scheduleState.status === "empty" ? <div className="status-rail-note">{scheduleBoard?.note ?? "The feed is up, but there is nothing on the board yet."}</div> : null}
      {scheduleState.status === "success" && scheduleBoard ? (
        <div className="status-list">
          {scheduleBoard.games.slice(0, 6).map((game) => (
            <div className={`status-list-row is-clickable ${game.projection.blocked.is_blocked ? "rejected" : "approved"}`} key={game.game_id}>
              <button
                aria-label={buildGameDetailButtonLabel(game)}
                className="detail-hitarea"
                type="button"
                onClick={() => {
                  onOpenGameDetail(game.game_id);
                }}
              />
              <div className="status-list-topline">
                <span className={`status-list-badge ${game.projection.blocked.is_blocked ? "rejected" : "approved"}`}>{formatProjectionReadyLabel(game)}</span>
                <span className="status-list-tier">{formatStatusLabel(game.status)}</span>
              </div>
              <strong>
                {game.away_team.abbreviation} at {game.home_team.abbreviation}
              </strong>
              <div className="status-list-meta">
                <span>{formatScheduledStart(game.scheduled_start)}</span>
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
        <p>{scheduleBoard?.note ?? "The route responded, but the board is empty."}</p>
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
  projectionBoard,
  onOpenGameDetail,
}: {
  scheduleState: ScheduleState;
  projectionBoard: GameProjectionBoard | null;
  onOpenGameDetail: (gameId: ScheduleBoardPayload["games"][number]["game_id"]) => void;
}) => {
  const [filter, setFilter] = useState<"all" | "ready" | "held">("all");
  const [sortBy, setSortBy] = useState<"default" | "total">("default");

  return (
  <section className="workspace-panel" role="tabpanel" aria-labelledby="tab-game-projections">
    <div className="workspace-header">
      <div className="workspace-header-copy">
        <p className="workspace-eyebrow">Game Projections</p>
        <h2>Modeled Matchups</h2>
        <p className="workspace-copy">This board makes the matchup projection itself primary: projected score, favorite, run margin, total, and blocked state from the live route. No market lines, weather overlays, or injury dressing.</p>
      </div>
      <div className="workspace-pill-stack">
        <span className="workspace-pill">{projectionBoard ? formatSourceLabel(projectionBoard.source) : "Feed pending"}</span>
        <span className="workspace-pill">{projectionBoard ? `${projectionBoard.summary.projection_ready_games} ready` : "Waiting on projections"}</span>
        <span className="workspace-pill">{projectionBoard ? `Built ${formatGeneratedStamp(projectionBoard.generated_at)}` : "Waiting on update"}</span>
      </div>
    </div>

    <div className="workspace-board-heading">
      <div>
        <span className="workspace-board-kicker">Projection board</span>
        <h3 className="workspace-board-title">Today&apos;s Models</h3>
      </div>
      <p className="workspace-board-note">
        {projectionBoard?.summary.strongest_favorite ? `${projectionBoard.summary.strongest_favorite.team_abbreviation} ${(projectionBoard.summary.strongest_favorite.value * 100).toFixed(1)}% top favorite` : "No ready projections yet"}
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
        <p>{projectionBoard?.note ?? "The route responded, but the board is empty."}</p>
      </div>
    ) : null}

    {scheduleState.status === "success" && projectionBoard ? (
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
          <span>{projectionBoard.summary.total_games} games</span>
          <span>{projectionBoard.summary.projection_ready_games} ready</span>
          <span>{projectionBoard.summary.games_ready_for_player_projections} player-ready</span>
          <span>{projectionBoard.summary.blocked_games} blocked</span>
          <span>{projectionBoard.summary.highest_total ? `Highest total ${projectionBoard.summary.highest_total.value.toFixed(1)}` : "No total yet"}</span>
          <span>{projectionBoard.summary.average_ready_total === null ? "No ready average" : `Avg ready total ${projectionBoard.summary.average_ready_total.toFixed(1)}`}</span>
        </div>
        <div className="projection-match-list">
          {projectionBoard.games
              .filter((game) => filter === "all" || (filter === "ready" ? !game.blocked.is_blocked : game.blocked.is_blocked))
              .sort((a, b) => sortBy === "total" ? ((b.projected_total ?? -1) - (a.projected_total ?? -1)) : 0)
              .map((game) => {
            const favoriteLabel = formatFavoriteLabel(game);
            const marginLabel = formatProjectedMarginLabel(game);
            const totalLabel = game.projected_total === null ? null : `Total ${game.projected_total.toFixed(1)}`;
            const averageTotalLabel = formatAverageTotalLabel(game);
            const completenessLabel = `${Math.round(game.completeness_score * 100)}% inputs`;

            return (
              <article className={`projection-match is-clickable ${game.blocked.is_blocked ? "blocked" : "ready"}`} key={game.game_id}>
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
                    <p className={`projection-match-kicker ${game.blocked.is_blocked ? "blocked" : "ready"}`}>{game.blocked.is_blocked ? "Projection blocked" : "Projection ready"}</p>
                    <h3>{game.matchup}</h3>
                  </div>
                  <div className="projection-match-meta">
                    <span>{formatScheduledStart(game.scheduled_start)}</span>
                    <span>{formatStatusLabel(game.status)}</span>
                    <span>{game.venue_name ?? "Venue pending"}</span>
                  </div>
                </div>

                {game.blocked.is_blocked ? (
                  <div className="projection-match-blocked">
                    <div className="projection-match-copy">
                      <p className="projection-match-note">{game.starter_summary}</p>
                      <p className="projection-match-subnote">{game.availability_summary}</p>
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
                        <strong>{formatProjectedRuns(game.projected_away_runs)}</strong>
                      </div>
                      <div className="projection-score-divider">proj</div>
                      <div className="projection-score-team">
                        <span>{game.home_team.abbreviation}</span>
                        <strong>{formatProjectedRuns(game.projected_home_runs)}</strong>
                      </div>
                    </div>
                    <div className="projection-match-copy">
                      <div className="projection-chip-row">
                        {favoriteLabel ? <span className="signal-chip signal-chip-primary">{favoriteLabel}</span> : null}
                        {marginLabel ? <span className="signal-chip signal-chip-neutral">{marginLabel}</span> : null}
                        {totalLabel ? <span className="signal-chip signal-chip-neutral">{totalLabel}</span> : null}
                        {averageTotalLabel ? <span className="signal-chip signal-chip-neutral">{averageTotalLabel}</span> : null}
                      </div>
                      <p className="projection-match-note">{game.starter_summary}</p>
                      <p className="projection-match-subnote">{game.availability_summary}</p>
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
      <article className={`player-card ${player.projection.blocked.is_blocked ? "held" : "ready"}`} key={player.player_id}>
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

const PlayerProjectionsWorkspace = ({ playerState, playerProjectionBoard }: { playerState: PlayerState; playerProjectionBoard: PlayerProjectionBoard | null }) => {
  const populationCopy = buildPlayerBoardPopulationCopy(playerProjectionBoard);

  return (
    <section className="workspace-panel" role="tabpanel" aria-labelledby="tab-player-projections">
      <div className="workspace-header">
        <div className="workspace-header-copy">
          <p className="workspace-eyebrow">Player Projections</p>
          <h2>Cleared Player Board</h2>
          <p className="workspace-copy">This board shows pitchers and batters from today&apos;s projected matchups. Players appear once their game has a live projection and both lineups are in.</p>
        </div>
        <div className="workspace-pill-stack">
          <span className="workspace-pill">{playerProjectionBoard ? formatSourceLabel(playerProjectionBoard.source) : "Feed pending"}</span>
          <span className="workspace-pill">{playerProjectionBoard ? `${playerProjectionBoard.summary.projected_players} player-ready` : "Waiting on players"}</span>
          <span className="workspace-pill">{playerProjectionBoard ? `Built ${formatGeneratedStamp(playerProjectionBoard.generated_at)}` : "Waiting on update"}</span>
        </div>
      </div>

      <div className="workspace-board-heading">
        <div>
          <span className="workspace-board-kicker">Player board</span>
          <h3 className="workspace-board-title">Today&apos;s Players</h3>
        </div>
        <p className="workspace-board-note">
          {playerProjectionBoard?.summary.top_projected_player
            ? `${playerProjectionBoard.summary.top_projected_player.full_name} ${playerProjectionBoard.summary.top_projected_player.projected_points.toFixed(1)} pts top board`
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
          <p>{playerProjectionBoard?.note ?? "This board fills once projected matchups have cleared into live player rows."}</p>
        </div>
      ) : null}

      {playerState.status === "success" && playerProjectionBoard ? (
        <div className="player-board">
          <div className="player-board-title">Today&apos;s Player Board</div>
          <div className="player-summary-strip">
            <span>{playerProjectionBoard.summary.total_players} players</span>
            <span>{playerProjectionBoard.summary.projected_players} player-ready</span>
            <span>{playerProjectionBoard.summary.blocked_players} held</span>
            <span>{playerProjectionBoard.summary.ready_pitchers} pitchers</span>
            <span>{playerProjectionBoard.summary.ready_batters} bats</span>
            <span>{playerProjectionBoard.summary.games_covered} games</span>
          </div>
          <BoardPopulationNote copy={populationCopy} />

          <section className="player-section">
            <div className="player-section-header">
              <strong>Pitchers</strong>
              <span>{playerProjectionBoard.summary.ready_pitchers} ready</span>
            </div>
            {playerProjectionBoard.ready_pitchers.length > 0 ? (
              <PlayerCardGrid players={playerProjectionBoard.ready_pitchers} />
            ) : (
              <div className="player-section-empty">No pitchers have cleared from today&apos;s projected matchups yet.</div>
            )}
          </section>

          <section className="player-section">
            <div className="player-section-header">
              <strong>Batters</strong>
              <span>{playerProjectionBoard.summary.ready_batters} ready</span>
            </div>
            {playerProjectionBoard.ready_batters.length > 0 ? (
              <PlayerCardGrid players={playerProjectionBoard.ready_batters} />
            ) : (
              <div className="player-section-empty">No batters have cleared from today&apos;s projected matchups yet.</div>
            )}
          </section>

          {playerProjectionBoard.held_players.length > 0 ? (
            <section className="player-section held">
              <div className="player-section-header">
                <strong>Held</strong>
                <span>{playerProjectionBoard.held_players.length} waiting on projection</span>
              </div>
              <PlayerCardGrid players={playerProjectionBoard.held_players} />
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

const DfsEdgeWorkspace = ({ dfsState, dfsBoard }: { dfsState: DfsState; dfsBoard: DfsEdgeBoardPayload | null }) => {
  const populationCopy = buildDfsBoardPopulationCopy(dfsBoard);

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
          <p>{dfsBoard?.note ?? "This board fills once player rows have a live DraftKings Classic salary."}</p>
        </div>
      ) : null}

      {dfsState.status === "success" && dfsBoard ? (
        <div className="player-board">
          <div className="player-board-title">DraftKings Classic Board</div>
          <div className="player-summary-strip">
            <span>{dfsBoard.summary.ready_players} DraftKings-ready</span>
            <span>{dfsBoard.summary.held_players} held</span>
            <span>{dfsBoard.summary.ready_pitchers} pitchers</span>
            <span>{dfsBoard.summary.ready_batters} bats</span>
            <span>{dfsBoard.summary.average_ready_salary === null ? "No avg salary" : `Avg salary ${formatDraftKingsClassicSalary(Math.round(dfsBoard.summary.average_ready_salary))}`}</span>
            <span>{dfsBoard.summary.average_ready_value === null ? "No avg value" : `Avg value ${formatDraftKingsClassicValue(dfsBoard.summary.average_ready_value)}`}</span>
          </div>
          <BoardPopulationNote copy={populationCopy} />

          <section className="player-section">
            <div className="player-section-header">
              <strong>Pitchers</strong>
              <span>{dfsBoard.summary.ready_pitchers} DraftKings-ready</span>
            </div>
            {dfsBoard.ready_pitchers.length > 0 ? <DfsEdgeCardGrid players={dfsBoard.ready_pitchers} /> : <div className="player-section-empty">No pitchers have both a projection and a DraftKings Classic salary yet.</div>}
          </section>

          <section className="player-section">
            <div className="player-section-header">
              <strong>Batters</strong>
              <span>{dfsBoard.summary.ready_batters} DraftKings-ready</span>
            </div>
            {dfsBoard.ready_batters.length > 0 ? <DfsEdgeCardGrid players={dfsBoard.ready_batters} /> : <div className="player-section-empty">No batters have both a projection and a DraftKings Classic salary yet.</div>}
          </section>

          {dfsBoard.held_players.length > 0 ? (
            <section className="player-section held">
              <div className="player-section-header">
                <strong>Held</strong>
                <span>{dfsBoard.held_players.length} waiting on DraftKings Classic salary</span>
              </div>
              <DfsEdgeCardGrid players={dfsBoard.held_players} />
            </section>
          ) : null}
        </div>
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
  const populationCopy = buildBettingBoardPopulationCopy(bettingBoard);

  return (
    <section className="workspace-panel" role="tabpanel" aria-labelledby="tab-betting-edge">
      <div className="workspace-header">
        <div className="workspace-header-copy">
          <p className="workspace-eyebrow">Betting Edge</p>
          <h2>DraftKings Sportsbook</h2>
          <p className="workspace-copy">
            This board only uses projection-ready game rows plus live DraftKings Sportsbook MLB pregame moneyline truth. It surfaces one-book moneyline odds and derived edge without totals, props, or multi-book comparison.
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
          <p>{bettingBoard?.note ?? "This board fills once projected matchups have a live DraftKings Sportsbook pregame moneyline."}</p>
        </div>
      ) : null}

      {bettingState.status === "success" && bettingBoard ? (
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

          <section className="player-section">
            <div className="player-section-header">
              <strong>Moneyline-ready</strong>
              <span>{bettingBoard.summary.ready_games} ready</span>
            </div>
            {bettingBoard.ready_games.length > 0 ? (
              <BettingEdgeMatchList games={bettingBoard.ready_games} />
            ) : (
              <div className="player-section-empty">No projected matchup has a live DraftKings Sportsbook pregame moneyline yet.</div>
            )}
          </section>

          {bettingBoard.held_games.length > 0 ? (
            <section className="player-section held">
              <div className="player-section-header">
                <strong>Held</strong>
                <span>{bettingBoard.held_games.length} waiting on DraftKings Sportsbook moneyline</span>
              </div>
              <BettingEdgeMatchList games={bettingBoard.held_games} />
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

const PlaceholderWorkspace = ({ tabId }: { tabId: InactiveTabId }) => {
  const placeholder = TAB_PLACEHOLDERS[tabId];

  return (
    <section className="workspace-panel" role="tabpanel" aria-labelledby={`tab-${tabId}`}>
      <div className="workspace-header">
        <div className="workspace-header-copy">
          <p className="workspace-eyebrow">{placeholder.eyebrow}</p>
          <h2>{placeholder.title}</h2>
          <p className="workspace-copy">{placeholder.body}</p>
        </div>
        <div className="workspace-pill-stack">
          <span className="workspace-pill">Status: Not yet active</span>
        </div>
      </div>
      <div className="placeholder-panel">
        <div className="placeholder-panel-card">
          <p className="workspace-eyebrow">Truth</p>
          <h3>This tab is intentionally parked.</h3>
          <p>{placeholder.note}</p>
        </div>
        <div className="placeholder-panel-card muted">
          <p className="workspace-eyebrow">Why</p>
          <h3>Five live boards first.</h3>
          <p>This phase promotes five real boards with real route data. The rest of the shell stays visible without pretending more live product surfaces exist.</p>
        </div>
      </div>
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

  const scheduleBoard = scheduleState.board;
  const summary = scheduleBoard?.summary ?? EMPTY_SCHEDULE_SUMMARY;
  const projectionBoard = scheduleBoard ? buildGameProjectionBoard(scheduleBoard) : null;
  const playerBoard = playerState.board;
  const playerProjectionBoard = playerBoard ? buildPlayerProjectionBoard(playerBoard) : null;
  const dfsBoard = dfsState.board;
  const bettingBoard = bettingState.board;
  const selectedGame = selectedGameId === null ? null : (scheduleBoard?.games.find((game) => game.game_id === selectedGameId) ?? null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadSchedule = async (): Promise<void> => {
      try {
        const response = await fetch(SCHEDULE_ROUTE, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as unknown;

        if (!response.ok) {
          throw new Error(readResponseError(payload) ?? `Schedule board request failed with status ${response.status}.`);
        }

        const parsed = parseScheduleBoardPayload(payload);
        if (!cancelled) {
          setScheduleState({
            status: parsed.games.length === 0 ? "empty" : "success",
            board: parsed,
            error: null,
          });
        }
      } catch (error) {
        if (!cancelled && !(error instanceof Error && error.name === "AbortError")) {
          setScheduleState({
            status: "error",
            board: null,
            error: getErrorMessage(error),
          });
        }
      }
    };

    const loadPlayers = async (): Promise<void> => {
      try {
        const response = await fetch(PLAYER_ROUTE, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as unknown;

        if (!response.ok) {
          throw new Error(readResponseError(payload) ?? `Player board request failed with status ${response.status}.`);
        }

        const parsed = parsePlayerBoardPayload(payload);
        if (!cancelled) {
          setPlayerState({
            status: parsed.players.length === 0 ? "empty" : "success",
            board: parsed,
            error: null,
          });
        }
      } catch (error) {
        if (!cancelled && !(error instanceof Error && error.name === "AbortError")) {
          setPlayerState({
            status: "error",
            board: null,
            error: getErrorMessage(error),
          });
        }
      }
    };

    const loadDfsEdge = async (): Promise<void> => {
      try {
        const response = await fetch(DFS_EDGE_ROUTE, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as unknown;

        if (!response.ok) {
          throw new Error(readResponseError(payload) ?? `DFS edge request failed with status ${response.status}.`);
        }

        const parsed = parseDfsEdgeBoardPayload(payload);
        const totalRows = parsed.ready_pitchers.length + parsed.ready_batters.length + parsed.held_players.length;

        if (!cancelled) {
          setDfsState({
            status: totalRows === 0 ? "empty" : "success",
            board: parsed,
            error: null,
          });
        }
      } catch (error) {
        if (!cancelled && !(error instanceof Error && error.name === "AbortError")) {
          setDfsState({
            status: "error",
            board: null,
            error: getErrorMessage(error),
          });
        }
      }
    };

    const loadBettingEdge = async (): Promise<void> => {
      try {
        const response = await fetch(BETTING_EDGE_ROUTE, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as unknown;

        if (!response.ok) {
          throw new Error(readResponseError(payload) ?? `Betting edge request failed with status ${response.status}.`);
        }

        const parsed = parseBettingEdgeBoardPayload(payload);
        const totalRows = parsed.ready_games.length + parsed.held_games.length;

        if (!cancelled) {
          setBettingState({
            status: totalRows === 0 ? "empty" : "success",
            board: parsed,
            error: null,
          });
        }
      } catch (error) {
        if (!cancelled && !(error instanceof Error && error.name === "AbortError")) {
          setBettingState({
            status: "error",
            board: null,
            error: getErrorMessage(error),
          });
        }
      }
    };

    loadSchedule().catch((error: unknown) => {
      if (!cancelled) {
        setScheduleState({
          status: "error",
          board: null,
          error: getErrorMessage(error),
        });
      }
    });
    loadPlayers().catch((error: unknown) => {
      if (!cancelled) {
        setPlayerState({
          status: "error",
          board: null,
          error: getErrorMessage(error),
        });
      }
    });
    loadDfsEdge().catch((error: unknown) => {
      if (!cancelled) {
        setDfsState({
          status: "error",
          board: null,
          error: getErrorMessage(error),
        });
      }
    });
    loadBettingEdge().catch((error: unknown) => {
      if (!cancelled) {
        setBettingState({
          status: "error",
          board: null,
          error: getErrorMessage(error),
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
        <StatusRail scheduleState={scheduleState} scheduleBoard={scheduleBoard} summary={summary} onOpenGameDetail={setSelectedGameId} />

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
              <GameProjectionsWorkspace scheduleState={scheduleState} projectionBoard={projectionBoard} onOpenGameDetail={setSelectedGameId} />
            ) : activeTab === "player-projections" ? (
              <PlayerProjectionsWorkspace playerState={playerState} playerProjectionBoard={playerProjectionBoard} />
            ) : activeTab === "dfs-edge" ? (
              <DfsEdgeWorkspace dfsState={dfsState} dfsBoard={dfsBoard} />
            ) : activeTab === "betting-edge" ? (
              <BettingEdgeWorkspace bettingState={bettingState} bettingBoard={bettingBoard} />
            ) : (
              <PlaceholderWorkspace tabId={activeTab} />
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
