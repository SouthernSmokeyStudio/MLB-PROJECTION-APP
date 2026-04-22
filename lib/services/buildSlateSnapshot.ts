import type { BettingEdgeBoardPayload } from "@lib/contracts/betting-edge-board";
import type { DfsEdgeBoardPayload } from "@lib/contracts/dfs-edge-board";
import type { LiveScoreboardPayload } from "@lib/contracts/live-scoreboard";
import type { PlayerBoardPayload } from "@lib/contracts/player-board";
import type { SmokeSignalPayload } from "@lib/contracts/smoke-signal";
import type {
  SlateSnapshotPayload,
  SlateSnapshotSectionKey,
  SlateSnapshotSectionState,
  SlateSnapshotSectionStatus,
  SlateSnapshotWrappedSection
} from "@lib/contracts/slate-snapshot";
import { asISOTimestamp } from "@lib/contracts/types";
import { buildBettingEdgeBoard, type BuildBettingEdgeBoardOptions } from "./buildBettingEdgeBoard";
import { buildDfsEdgeBoard, type BuildDfsEdgeBoardOptions } from "./buildDfsEdgeBoard";
import { buildLiveScoreboard } from "./buildLiveScoreboard";
import { buildSmokeSignal } from "./buildSmokeSignal";
import { buildPlayerBoard } from "./buildPlayerBoard";
import { buildScheduleBoard } from "./buildScheduleBoard";
import type { LiveSlateCounts, LiveSlateSourceGame } from "./loadLiveSlate";
import { loadCrosswalk } from "@lib/crosswalk/loadCrosswalk";
import { indexCrosswalk } from "@lib/crosswalk/resolvePlayerIdentity";
import type { LoadedDraftKingsClassicSlateItem } from "./loadDraftKingsClassicSlate";
import { assembleGameProjection, type AssembledGameProjection } from "@lib/projections/assembleGameProjection";

export interface BuildSlateSnapshotOptions {
  readonly source: string;
  readonly date: string;
  readonly counts: LiveSlateCounts;
  readonly generated_at?: string;
  /**
   * Pre-assembled projections keyed by game_id. When provided, buildSlateSnapshot
   * uses these directly instead of calling assembleGameProjection a second time.
   * Callers that already assembled projections for other steps (e.g. morning-capture
   * assembles for player persistence) should pass the same map here to guarantee
   * parent truth is consistent across all boards and the published snapshot.
   */
  readonly preassembled?: ReadonlyMap<string, AssembledGameProjection>;
  readonly simulation?: {
    readonly seed?: number;
    readonly iterations?: number;
  };
  readonly schedule?: {
    readonly source?: string;
    readonly note?: string | null;
  };
  readonly player_projections?: {
    readonly source?: string;
    readonly note?: string | null;
  };
  readonly dfs_edge?: Omit<
    BuildDfsEdgeBoardOptions,
    "date" | "generated_at" | "counts" | "simulation"
  > & {
    readonly note?: string | null;
    readonly salary_slate_inventory?: readonly LoadedDraftKingsClassicSlateItem[];
  };
  readonly dfs_edge_reason?: string;
  /**
   * Emit DFS Edge rows using projection data only. Salary is unavailable so
   * every row is held with `salary-unavailable`. The contest header is null.
   * Ignored when `dfs_edge` or `dfs_edge_reason` is also set.
   */
  readonly dfs_edge_degraded?: {
    readonly source?: string;
    readonly note?: string | null;
  };
  readonly betting_edge?: Omit<
    BuildBettingEdgeBoardOptions,
    "date" | "generated_at" | "counts" | "simulation"
  > & {
    readonly note?: string | null;
  };
  readonly betting_edge_reason?: string;
  /**
   * Emit Betting Edge rows using projection data only. Market data is
   * unavailable so every row is held with `market-unavailable`. The sportsbook
   * header is null. Ignored when `betting_edge` or `betting_edge_reason` is
   * also set.
   */
  readonly betting_edge_degraded?: {
    readonly source?: string;
    readonly note?: string | null;
  };
  readonly schedule_reason?: string;
  readonly player_projections_reason?: string;
  readonly smoke_signal_reason?: string;
  readonly live_scoreboard_reason?: string;
}

const buildStatus = (
  state: SlateSnapshotSectionState,
  reason: string | null = null
): SlateSnapshotSectionStatus => ({
  state,
  reason
});

const wrapSection = <TPayload>(
  payload: TPayload | null,
  status: SlateSnapshotSectionStatus
): SlateSnapshotWrappedSection<TPayload> => ({
  status,
  payload
});

const buildDfsStatus = (payload: DfsEdgeBoardPayload): SlateSnapshotSectionStatus => {
  const totalRows =
    payload.ready_pitchers.length + payload.ready_batters.length + payload.held_players.length;

  if (totalRows === 0) {
    return buildStatus("empty", payload.note ?? "DFS Edge has no wrapped rows.");
  }

  if (payload.summary.ready_players > 0 && payload.summary.held_players > 0) {
    return buildStatus("partial", payload.note ?? "DFS Edge includes ready and held rows.");
  }

  if (payload.summary.ready_players > 0) {
    return buildStatus("ready");
  }

  return buildStatus("partial", payload.note ?? "DFS Edge rows are present but still held.");
};

const buildBettingStatus = (payload: BettingEdgeBoardPayload): SlateSnapshotSectionStatus => {
  const totalRows = payload.ready_games.length + payload.held_games.length;

  if (totalRows === 0) {
    return buildStatus("empty", payload.note ?? "Betting Edge has no wrapped rows.");
  }

  if (payload.summary.ready_games > 0 && payload.summary.held_games > 0) {
    return buildStatus(
      "partial",
      payload.note ?? "Betting Edge includes ready and held rows."
    );
  }

  if (payload.summary.ready_games > 0) {
    return buildStatus("ready", payload.note ?? undefined);
  }

  return buildStatus(
    "partial",
    payload.note ?? "Betting Edge rows are present but still held."
  );
};

const buildLiveScoreboardStatus = (
  payload: LiveScoreboardPayload
): SlateSnapshotSectionStatus => {
  if (payload.games.length === 0) {
    return buildStatus("empty", payload.note ?? "Live scoreboard has no wrapped games.");
  }

  if (payload.summary.blocked_games > 0) {
    return buildStatus(
      "partial",
      payload.note ?? "Live scoreboard includes games with missing live-score state."
    );
  }

  return buildStatus("ready");
};

const buildSmokeSignalStatus = (
  payload: SmokeSignalPayload
): SlateSnapshotSectionStatus => {
  if (payload.summary.ready_signals === 0) {
    return buildStatus("empty", payload.note ?? "Smoke Signal has no canonical highlights yet.");
  }

  if (payload.summary.blocked_signals > 0) {
    return buildStatus(
      "partial",
      payload.note ?? "Smoke Signal includes unavailable highlight slots."
    );
  }

  return buildStatus("ready");
};

const buildPlayerProjectionsStatus = (
  payload: PlayerBoardPayload
): SlateSnapshotSectionStatus => {
  if (payload.players.length === 0) {
    return buildStatus("empty", payload.note ?? "Player Projections has no wrapped rows.");
  }

  if (payload.summary.projected_players > 0) {
    return buildStatus("ready");
  }

  return buildStatus(
    "partial",
    payload.note ?? "Player rows exist but none are projectable yet."
  );
};

export const buildSlateSnapshot = (
  sourceGames: readonly LiveSlateSourceGame[],
  options: BuildSlateSnapshotOptions
): SlateSnapshotPayload => {
  const generatedAt = asISOTimestamp(options.generated_at ?? new Date().toISOString());
  const simulationOptions = options.simulation;

  // Pre-compute one AssembledGameProjection per game. All downstream boards
  // read from this shared map — no board recomputes the game projection
  // independently. This is the single authoritative parent truth for this
  // snapshot build. Each entry is keyed by game_id.
  //
  // When the caller already assembled projections (e.g. morning-capture builds
  // them for player persistence), those are passed in via options.preassembled
  // to guarantee consistent parent truth across all steps of the pipeline.
  const preassembledProjections: ReadonlyMap<string, AssembledGameProjection> =
    options.preassembled ??
    new Map(
      sourceGames.map((g) => [g.preparedGame.game_id, assembleGameProjection(g.preparedGame)])
    );

  // Load + index crosswalk from committed file. Fail closed: null on any load/validate failure.
  // The crosswalk is only activated when at least one entry has a linked dk_player_id,
  // otherwise the salary join would hold every resolved player with no benefit.
  const loadedCrosswalk = (() => {
    const raw = loadCrosswalk();
    if (!raw) return null;
    const hasLinkedEntry = raw.entries.some((entry) => entry.dk_player_id !== null);
    return hasLinkedEntry ? indexCrosswalk(raw) : null;
  })();
  const schedulePayload = buildScheduleBoard(sourceGames, {
    source: options.schedule?.source ?? options.source,
    date: options.date,
    generated_at: generatedAt,
    counts: options.counts,
    note: options.schedule?.note ?? null,
    preassembled: preassembledProjections,
    ...(simulationOptions ? { simulation: simulationOptions } : {})
  });
  const playerPayload = buildPlayerBoard(sourceGames, {
    source: options.player_projections?.source ?? options.source,
    date: options.date,
    generated_at: generatedAt,
    counts: options.counts,
    note: options.player_projections?.note ?? null,
    preassembled: preassembledProjections,
    ...(simulationOptions ? { simulation: simulationOptions } : {})
  });

  const schedule = options.schedule_reason
    ? wrapSection(
        schedulePayload,
        buildStatus("blocked", options.schedule_reason)
      )
    : wrapSection(
        schedulePayload,
        buildStatus(
          schedulePayload.games.length === 0 ? "empty" : "ready",
          schedulePayload.games.length === 0
            ? schedulePayload.note ?? "Schedule has no wrapped games."
            : null
        )
      );
  const playerProjections = options.player_projections_reason
    ? wrapSection(
        playerPayload,
        buildStatus("blocked", options.player_projections_reason)
      )
    : wrapSection(
        playerPayload,
        buildPlayerProjectionsStatus(playerPayload)
      );

  const dfsEdge = options.dfs_edge
    ? (() => {
        // Caller-supplied crosswalk wins; otherwise use auto-loaded from disk.
        const effectiveCrosswalk = options.dfs_edge.crosswalk ?? loadedCrosswalk;

        const payload = buildDfsEdgeBoard(sourceGames, {
          ...options.dfs_edge,
          date: options.date,
          generated_at: generatedAt,
          counts: options.counts,
          preassembled: preassembledProjections,
          ...(simulationOptions ? { simulation: simulationOptions } : {}),
          ...(effectiveCrosswalk ? { crosswalk: effectiveCrosswalk } : {})
        });

        return wrapSection(payload, buildDfsStatus(payload));
      })()
    : options.dfs_edge_degraded
    ? (() => {
        const payload = buildDfsEdgeBoard(sourceGames, {
          source: options.dfs_edge_degraded!.source ?? options.source,
          date: options.date,
          generated_at: generatedAt,
          counts: options.counts,
          note: options.dfs_edge_degraded!.note ?? null,
          preassembled: preassembledProjections,
          // No draftkings_classic → salary-degraded mode
          ...(simulationOptions ? { simulation: simulationOptions } : {}),
          ...(loadedCrosswalk ? { crosswalk: loadedCrosswalk } : {})
        });

        return wrapSection(payload, buildDfsStatus(payload));
      })()
    : wrapSection<DfsEdgeBoardPayload>(
        null,
        buildStatus(
          "blocked",
          options.dfs_edge_reason ??
            "DFS Edge stays transitional until the canonical snapshot path is active."
        )
      );

  const bettingEdge = options.betting_edge
    ? (() => {
        const payload = buildBettingEdgeBoard(sourceGames, {
          ...options.betting_edge,
          date: options.date,
          generated_at: generatedAt,
          counts: options.counts,
          preassembled: preassembledProjections,
          ...(simulationOptions ? { simulation: simulationOptions } : {})
        });

        return wrapSection(payload, buildBettingStatus(payload));
      })()
    : options.betting_edge_degraded
    ? (() => {
        const payload = buildBettingEdgeBoard(sourceGames, {
          source: options.betting_edge_degraded!.source ?? options.source,
          date: options.date,
          generated_at: generatedAt,
          counts: options.counts,
          note: options.betting_edge_degraded!.note ?? null,
          draftkings_sportsbook_moneyline: { site: "US-TN-SB", label: "DraftKings Sportsbook MLB Pregame Moneyline" },
          preassembled: preassembledProjections,
          // No moneyline_slate → market-degraded mode
          ...(simulationOptions ? { simulation: simulationOptions } : {})
        });

        return wrapSection(payload, buildBettingStatus(payload));
      })()
    : wrapSection<BettingEdgeBoardPayload>(
        null,
        buildStatus(
          "blocked",
          options.betting_edge_reason ??
            "Betting Edge stays transitional until the canonical snapshot path is active."
        )
      );

  const liveScoreboardPayload = buildLiveScoreboard(sourceGames, {
    source: options.source,
    date: options.date,
    generated_at: generatedAt,
    counts: options.counts,
    note: options.live_scoreboard_reason ?? null
  });
  const liveScoreboard = wrapSection(
    liveScoreboardPayload,
    buildLiveScoreboardStatus(liveScoreboardPayload)
  );
  const smokeSignalPayload = buildSmokeSignal({
    source: options.source,
    date: options.date,
    generated_at: generatedAt,
    note: options.smoke_signal_reason ?? null,
    schedule: schedulePayload,
    player_projections: playerPayload,
    dfs_edge: dfsEdge.payload,
    betting_edge: bettingEdge.payload,
    live_scoreboard: liveScoreboard.payload
  });
  const smokeSignal = wrapSection(
    smokeSignalPayload,
    buildSmokeSignalStatus(smokeSignalPayload)
  );

  const degradation = {
    schedule: schedule.status,
    player_projections: playerProjections.status,
    dfs_edge: dfsEdge.status,
    betting_edge: bettingEdge.status,
    smoke_signal: smokeSignal.status,
    live_scoreboard: liveScoreboard.status
  };

  const blockedSections = (
    Object.entries(degradation) as Array<[SlateSnapshotSectionKey, SlateSnapshotSectionStatus]>
  )
    .filter(([, status]) => status.state === "blocked")
    .map(([section]) => section);

  return {
    source: options.source,
    mode: "slate-snapshot-v1",
    version: 1,
    date: options.date,
    generated_at: generatedAt,
    counts: options.counts,
    publication: {
      is_complete: blockedSections.length === 0,
      blocked_sections: blockedSections
    },
    degradation,
    schedule,
    player_projections: playerProjections,
    dfs_edge: dfsEdge,
    betting_edge: bettingEdge,
    smoke_signal: smokeSignal,
    live_scoreboard: liveScoreboard
  };
};
