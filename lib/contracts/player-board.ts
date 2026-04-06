import type {
  BlockedState,
  GameId,
  GameStatus,
  ISOTimestamp,
  PlayerId,
  PlayerPosition,
  TeamId
} from "./types";

export interface PlayerBoardDeterministicPitcherSummary {
  readonly kind: "pitcher";
  readonly projected_ip: number | null;
  readonly projected_k: number | null;
  readonly projected_er: number | null;
  readonly projected_hits: number | null;
  readonly projected_bb: number | null;
}

export interface PlayerBoardDeterministicBatterSummary {
  readonly kind: "batter";
  readonly projected_pa: number | null;
  readonly projected_ab: number | null;
  readonly projected_hits: number | null;
  readonly projected_hr: number | null;
  readonly projected_rbi: number | null;
  readonly projected_runs: number | null;
  readonly projected_sb: number | null;
}

export type PlayerBoardDeterministicSummary =
  | PlayerBoardDeterministicPitcherSummary
  | PlayerBoardDeterministicBatterSummary
  | null;

export interface PlayerBoardFantasySummary {
  readonly platform: "draftkings" | "fanduel";
  readonly contest_type: "classic" | "showdown";
  readonly projected_points: number;
  readonly floor: number | null;
  readonly ceiling: number | null;
  readonly salary: number | null;
  readonly value: number | null;
}

export interface PlayerBoardSimulationSummary {
  readonly derived_from: "simulation";
  readonly mean_points: number;
  readonly simulated_floor: number;
  readonly simulated_ceiling: number;
}

export interface PlayerBoardProjection {
  readonly deterministic_summary: PlayerBoardDeterministicSummary;
  readonly fantasy_summary: PlayerBoardFantasySummary | null;
  readonly simulation_summary: PlayerBoardSimulationSummary | null;
  readonly blocked: BlockedState;
}

export interface PlayerBoardRow {
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
}

export interface PlayerBoardSummary {
  readonly total_players: number;
  readonly projected_players: number;
  readonly blocked_players: number;
  readonly pitchers: number;
  readonly batters: number;
  readonly games_covered: number;
}

export interface PlayerBoardCounts {
  readonly fetched_raw: number;
  readonly parsed: number;
  readonly normalized: number;
  readonly prepared: number;
  readonly boxscore_enriched: number;
}

export interface PlayerBoardPayload {
  readonly source: string;
  readonly mode: "player-board-v1";
  readonly date: string;
  readonly generated_at: ISOTimestamp;
  readonly summary: PlayerBoardSummary;
  readonly counts: PlayerBoardCounts;
  readonly players: readonly PlayerBoardRow[];
  readonly note: string | null;
}
