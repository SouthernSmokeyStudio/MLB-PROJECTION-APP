import type {
  BlockedState,
  GameId,
  GameStatus,
  ISOTimestamp,
  TeamId
} from "./types";
import type { ScheduleBoardCounts } from "./schedule-board";

export interface LiveScoreboardSummary {
  readonly total_games: number;
  readonly live_games: number;
  readonly final_games: number;
  readonly pregame_games: number;
  readonly blocked_games: number;
}

export interface LiveScoreboardGame {
  readonly game_id: GameId;
  readonly matchup: string;
  readonly scheduled_start: ISOTimestamp;
  readonly status: GameStatus;
  readonly venue_name: string | null;
  readonly away_team_id: TeamId;
  readonly away_team_abbreviation: string;
  readonly away_team_full_name: string;
  readonly home_team_id: TeamId;
  readonly home_team_abbreviation: string;
  readonly home_team_full_name: string;
  readonly away_score: number | null;
  readonly home_score: number | null;
  readonly inning_number: number | null;
  readonly inning_state: "top" | "middle" | "bottom" | "end" | null;
  readonly is_live: boolean;
  readonly is_final: boolean;
  readonly display_state: string | null;
  readonly blocked: BlockedState;
}

export interface LiveScoreboardPayload {
  readonly source: string;
  readonly mode: "live-scoreboard-v1";
  readonly date: string;
  readonly generated_at: ISOTimestamp;
  readonly summary: LiveScoreboardSummary;
  readonly counts: ScheduleBoardCounts;
  readonly games: readonly LiveScoreboardGame[];
  readonly note: string | null;
}
