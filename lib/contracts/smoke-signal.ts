import type {
  BlockedState,
  GameId,
  GameStatus,
  ISOTimestamp,
  PlayerId,
  PlayerPosition
} from "./types";

export interface SmokeSignalSummary {
  readonly total_sections_considered: number;
  readonly ready_signals: number;
  readonly blocked_signals: number;
}

export interface SmokeSignalOverview {
  readonly total_games: number;
  readonly projection_ready_games: number;
  readonly player_ready_games: number;
  readonly live_games: number;
  readonly blocked_games: number;
}

export interface SmokeSignalGameHighlight {
  readonly game_id: GameId;
  readonly matchup: string;
  readonly scheduled_start: ISOTimestamp;
  readonly status: GameStatus;
  readonly projected_total: number | null;
  readonly away_win_probability: number | null;
  readonly home_win_probability: number | null;
  readonly blocked: BlockedState;
}

export interface SmokeSignalPlayerHighlight {
  readonly player_id: PlayerId;
  readonly full_name: string | null;
  readonly team_abbreviation: string;
  readonly position: PlayerPosition;
  readonly game_id: GameId;
  readonly matchup: string;
  readonly projected_points: number | null;
  readonly blocked: BlockedState;
}

export interface SmokeSignalDfsHighlight {
  readonly player_id: PlayerId;
  readonly full_name: string;
  readonly team_abbreviation: string;
  readonly position: PlayerPosition;
  readonly projected_points: number;
  readonly salary: number;
  readonly value: number;
  readonly draft_group_id: string | null;
  readonly projected_ownership: number | null;
  readonly ownership_source: "placeholder" | "model" | "provider" | null;
}

export interface SmokeSignalBettingHighlight {
  readonly game_id: GameId;
  readonly matchup: string;
  readonly team_abbreviation: string;
  readonly team_full_name: string;
  readonly opponent_team_abbreviation: string;
  readonly market_odds_american: number;
  readonly fair_american_odds: number;
  readonly model_probability: number;
  readonly edge: number;
}

export interface SmokeSignalLivePulse {
  readonly total_games: number;
  readonly live_games: number;
  readonly final_games: number;
  readonly pregame_games: number;
  readonly blocked_games: number;
}

export interface SmokeSignalPayload {
  readonly source: string;
  readonly mode: "smoke-signal-v1";
  readonly date: string;
  readonly generated_at: ISOTimestamp;
  readonly summary: SmokeSignalSummary;
  readonly overview: SmokeSignalOverview;
  readonly top_projected_total_game: SmokeSignalGameHighlight | null;
  readonly top_projected_player: SmokeSignalPlayerHighlight | null;
  readonly top_dfs_value_player: SmokeSignalDfsHighlight | null;
  readonly top_betting_edge_side: SmokeSignalBettingHighlight | null;
  readonly live_pulse: SmokeSignalLivePulse | null;
  readonly note: string | null;
}
