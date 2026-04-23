import type {
  BlockedState,
  GameId,
  GameStatus,
  Handedness,
  ISOTimestamp,
  PlayerId,
  StartingStatus,
  TeamId
} from "./types";

export type ScheduleBoardPlayerProjectionStatus = "ready" | "held";

export interface ScheduleBoardPitcher {
  readonly player_id: PlayerId | null;
  readonly full_name: string | null;
  readonly handedness: Handedness;
  readonly starting_status: StartingStatus;
}

export interface ScheduleBoardTeam {
  readonly team_id: TeamId;
  readonly abbreviation: string;
  readonly full_name: string;
  readonly probable_pitcher: ScheduleBoardPitcher | null;
  readonly lineup_batters_available: number;
}

export interface ScheduleBoardProjection {
  readonly blocked: BlockedState;
  readonly projected_away_runs: number | null;
  readonly projected_home_runs: number | null;
  readonly projected_total: number | null;
  readonly away_win_probability: number | null;
  readonly home_win_probability: number | null;
  readonly average_total_runs: number | null;
}

export interface ScheduleBoardWeather {
  readonly temperature_f: number | null;
  readonly wind_speed_mph: number | null;
  readonly wind_direction: string | null;
  readonly conditions: string | null;
  readonly precipitation_chance: number | null;
  readonly dome_closed: boolean | null;
}

export interface ScheduleBoardInputCoverage {
  readonly away_pitcher_handedness: Handedness;
  readonly home_pitcher_handedness: Handedness;
  readonly away_lineup_avg_woba: number | null;
  readonly home_lineup_avg_woba: number | null;
  readonly away_woba_batter_count: number;
  readonly home_woba_batter_count: number;
}

export interface ScheduleBoardGame {
  readonly game_id: GameId;
  readonly scheduled_start: ISOTimestamp;
  readonly status: GameStatus;
  readonly venue_name: string | null;
  readonly away_team: ScheduleBoardTeam;
  readonly home_team: ScheduleBoardTeam;
  readonly has_both_starters: boolean;
  readonly has_both_lineups: boolean;
  readonly completeness_score: number;
  readonly player_projection_status: ScheduleBoardPlayerProjectionStatus;
  readonly projection: ScheduleBoardProjection;
  readonly weather: ScheduleBoardWeather | null;
  readonly input_coverage: ScheduleBoardInputCoverage;
}

export interface ScheduleBoardSummary {
  readonly total_games: number;
  readonly projection_ready_games: number;
  readonly games_ready_for_player_projections: number;
  readonly blocked_games: number;
  readonly games_with_both_starters: number;
  readonly games_with_both_lineups: number;
}

export interface ScheduleBoardCounts {
  readonly fetched_raw: number;
  readonly parsed: number;
  readonly normalized: number;
  readonly prepared: number;
  readonly boxscore_enriched: number;
}

export interface ScheduleBoardPayload {
  readonly source: string;
  readonly mode: "schedule-board-v1";
  readonly date: string;
  readonly generated_at: ISOTimestamp;
  readonly summary: ScheduleBoardSummary;
  readonly counts: ScheduleBoardCounts;
  readonly games: readonly ScheduleBoardGame[];
  readonly note: string | null;
}
