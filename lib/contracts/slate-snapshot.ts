import type { BettingEdgeBoardPayload } from "./betting-edge-board";
import type { DfsEdgeBoardPayload } from "./dfs-edge-board";
import type { LiveScoreboardPayload } from "./live-scoreboard";
import type { PlayerBoardPayload } from "./player-board";
import type { ScheduleBoardCounts, ScheduleBoardPayload } from "./schedule-board";
import type { SmokeSignalPayload } from "./smoke-signal";
import type { ISOTimestamp } from "./types";

export type SlateSnapshotSectionKey =
  | "schedule"
  | "player_projections"
  | "dfs_edge"
  | "betting_edge"
  | "smoke_signal"
  | "live_scoreboard";

export type SlateSnapshotSectionState = "ready" | "partial" | "blocked" | "empty";

export interface SlateSnapshotSectionStatus {
  readonly state: SlateSnapshotSectionState;
  readonly reason: string | null;
}

export interface SlateSnapshotWrappedSection<TPayload> {
  readonly status: SlateSnapshotSectionStatus;
  readonly payload: TPayload | null;
}

export interface SlateSnapshotDegradation {
  readonly schedule: SlateSnapshotSectionStatus;
  readonly player_projections: SlateSnapshotSectionStatus;
  readonly dfs_edge: SlateSnapshotSectionStatus;
  readonly betting_edge: SlateSnapshotSectionStatus;
  readonly smoke_signal: SlateSnapshotSectionStatus;
  readonly live_scoreboard: SlateSnapshotSectionStatus;
}

export interface SlateSnapshotPublication {
  readonly is_complete: boolean;
  readonly blocked_sections: readonly SlateSnapshotSectionKey[];
}

export interface SlateSnapshotPayload {
  readonly source: string;
  readonly mode: "slate-snapshot-v1";
  readonly version: 1;
  readonly date: string;
  readonly generated_at: ISOTimestamp;
  readonly counts: ScheduleBoardCounts;
  readonly publication: SlateSnapshotPublication;
  readonly degradation: SlateSnapshotDegradation;
  readonly schedule: SlateSnapshotWrappedSection<ScheduleBoardPayload>;
  readonly player_projections: SlateSnapshotWrappedSection<PlayerBoardPayload>;
  readonly dfs_edge: SlateSnapshotWrappedSection<DfsEdgeBoardPayload>;
  readonly betting_edge: SlateSnapshotWrappedSection<BettingEdgeBoardPayload>;
  readonly smoke_signal: SlateSnapshotWrappedSection<SmokeSignalPayload>;
  readonly live_scoreboard: SlateSnapshotWrappedSection<LiveScoreboardPayload>;
}
