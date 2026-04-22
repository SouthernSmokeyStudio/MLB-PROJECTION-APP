import type {
  PlayerBoardCounts,
  PlayerBoardProjection
} from "./player-board";
import type {
  BlockedState,
  GameId,
  GameStatus,
  ISOTimestamp,
  PlayerId,
  PlayerPosition,
  TeamId
} from "./types";

export interface DfsEdgeBoardDraftKingsSummary {
  readonly platform: "draftkings";
  readonly contest_type: "classic";
  readonly draft_group_id: string;
  readonly label: string;
  readonly min_start_time: ISOTimestamp;
  readonly max_start_time: ISOTimestamp;
  readonly tags: readonly string[];
}

export interface DfsEdgeBoardPlayerHighlight {
  readonly player_id: PlayerId;
  readonly full_name: string;
  readonly team_abbreviation: string;
  readonly position: PlayerPosition;
  readonly projected_points: number;
  readonly salary: number;
  readonly value: number;
}

export interface DfsEdgeBoardSummary {
  readonly total_players: number;
  readonly ready_players: number;
  readonly held_players: number;
  readonly ready_pitchers: number;
  readonly ready_batters: number;
  readonly games_covered: number;
  readonly average_ready_salary: number | null;
  readonly average_ready_value: number | null;
  readonly top_value_player: DfsEdgeBoardPlayerHighlight | null;
}

export interface DfsJoinDiagnosticsResolverCounts {
  readonly mlb_stats_api_id: number;
  readonly dk_player_id: number;
  readonly rotowire_slug: number;
  readonly name_and_team: number;
  readonly unresolved: number;
  readonly legacy: number;
}

export interface DfsJoinDiagnosticsHeldReasonCounts {
  readonly reconciliation_failure: number;
  readonly upstream_blocked: number;
  readonly no_fantasy_summary: number;
  readonly crosswalk_unresolved: number;
  readonly crosswalk_no_dk_link: number;
  readonly salary_miss: number;
}

export interface DfsJoinDiagnostics {
  readonly resolver_method_counts: DfsJoinDiagnosticsResolverCounts;
  readonly held_reason_counts: DfsJoinDiagnosticsHeldReasonCounts;
  readonly reconciliation_failures_by_game: number;
}

export interface DfsEdgeBoardCounts extends PlayerBoardCounts {
  readonly salary_entries: number;
  readonly matched_salaries: number;
}

export interface DfsEdgeBoardRow {
  readonly player_id: PlayerId;
  readonly full_name: string | null;
  readonly position: PlayerPosition;
  readonly batting_order: number | null;
  readonly team_side: "away" | "home";
  readonly team_id: TeamId;
  readonly team_abbreviation: string;
  readonly team_full_name: string;
  readonly opponent_team_id: TeamId;
  readonly opponent_team_abbreviation: string;
  readonly opponent_team_full_name: string;
  readonly game_id: GameId;
  readonly matchup: string;
  readonly scheduled_start: ISOTimestamp;
  readonly status: GameStatus;
  readonly venue_name: string | null;
  readonly projection: PlayerBoardProjection;
  readonly draftkings_classic: {
    readonly platform: "draftkings";
    readonly contest_type: "classic";
    readonly draft_group_id: string;
    readonly draftable_id: string | null;
    readonly salary: number | null;
    readonly value: number | null;
    readonly projected_ownership: number | null;
    readonly ownership_source: "placeholder" | "model" | "provider" | null;
    readonly blocked: BlockedState;
  };
}

export interface DfsEdgeBoardPayload {
  readonly source: string;
  readonly mode: "dfs-edge-board-v1";
  readonly date: string;
  readonly generated_at: ISOTimestamp;
  readonly draftkings_classic: DfsEdgeBoardDraftKingsSummary | null;
  readonly summary: DfsEdgeBoardSummary;
  readonly counts: DfsEdgeBoardCounts;
  readonly join_diagnostics: DfsJoinDiagnostics;
  readonly ready_pitchers: readonly DfsEdgeBoardRow[];
  readonly ready_batters: readonly DfsEdgeBoardRow[];
  readonly held_players: readonly DfsEdgeBoardRow[];
  readonly note: string | null;
}
