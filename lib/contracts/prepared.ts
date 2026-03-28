import type {
  BlockedState,
  GameId,
  Handedness,
  ISOTimestamp,
  PlayerId,
  SportId,
  TeamId
} from "./types";

export interface PreparedVenueInputs {
  readonly park_factor_runs: number | null;
  readonly is_dome: boolean;
  readonly is_retractable_roof: boolean;
}

export interface PreparedWeatherInputs {
  readonly temperature_f: number | null;
  readonly wind_speed_mph: number | null;
  readonly wind_direction_normalized: "in" | "out" | "cross" | "calm" | null;
  readonly is_enclosed: boolean;
}

export interface PreparedPitcherInputs {
  readonly player_id: PlayerId;
  readonly team_id: TeamId;
  readonly handedness: Handedness;
  readonly season_ip: number | null;
  readonly season_era: number | null;
  readonly season_whip: number | null;
  readonly season_k_per_9: number | null;
  readonly season_bb_per_9: number | null;
  readonly season_hr_per_9: number | null;
  readonly recent_starts_n: number | null;
  readonly recent_era: number | null;
  readonly recent_k_per_9: number | null;
  readonly recent_ip_per_start: number | null;
  readonly vs_lhb_era: number | null;
  readonly vs_rhb_era: number | null;
  readonly days_rest: number | null;
  readonly last_start_pitches: number | null;
}

export interface PreparedBatterInputs {
  readonly player_id: PlayerId;
  readonly team_id: TeamId;
  readonly batting_order: number | null;
  readonly handedness: Handedness;
  readonly season_pa: number | null;
  readonly season_avg: number | null;
  readonly season_obp: number | null;
  readonly season_slg: number | null;
  readonly season_woba: number | null;
  readonly season_iso: number | null;
  readonly season_k_rate: number | null;
  readonly season_bb_rate: number | null;
  readonly season_hr_rate: number | null;
  readonly season_sb: number | null;
  readonly recent_games_n: number | null;
  readonly recent_woba: number | null;
  readonly recent_avg: number | null;
  readonly vs_lhp_woba: number | null;
  readonly vs_rhp_woba: number | null;
}

export interface PreparedTeamInputs {
  readonly team_id: TeamId;
  readonly team_woba: number | null;
  readonly team_runs_per_game: number | null;
  readonly team_k_rate: number | null;
  readonly team_bb_rate: number | null;
  readonly team_era: number | null;
  readonly team_whip: number | null;
  readonly bullpen_era: number | null;
  readonly lineup_batters_available: number;
  readonly lineup_avg_woba: number | null;
}

export interface PreparedGameInputs {
  readonly game_id: GameId;
  readonly sport_id: SportId;
  readonly scheduled_start: ISOTimestamp;
  readonly prepared_at: ISOTimestamp;
  readonly venue: PreparedVenueInputs | null;
  readonly weather: PreparedWeatherInputs | null;
  readonly away_team: PreparedTeamInputs;
  readonly home_team: PreparedTeamInputs;
  readonly away_starter: PreparedPitcherInputs | null;
  readonly home_starter: PreparedPitcherInputs | null;
  readonly away_batters: readonly PreparedBatterInputs[];
  readonly home_batters: readonly PreparedBatterInputs[];
  readonly blocked: BlockedState;
  readonly has_both_starters: boolean;
  readonly has_both_lineups: boolean;
  readonly completeness_score: number;
}
