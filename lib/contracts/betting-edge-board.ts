import type {
  BlockedState,
  GameId,
  GameStatus,
  ISOTimestamp
} from "./types";
import type { ScheduleBoardCounts } from "./schedule-board";

export interface BettingEdgeBoardSportsbookSummary {
  readonly provider: "draftkings-sportsbook";
  readonly sport: "MLB";
  readonly market_type: "moneyline";
  readonly site: "US-TN-SB";
  readonly label: string;
}

export interface BettingEdgeBoardMoneylineSide {
  readonly team_side: "away" | "home";
  readonly team_abbreviation: string;
  readonly team_full_name: string;
  readonly market_odds_american: number | null;
  readonly model_probability: number | null;
  readonly market_implied_probability: number | null;
  readonly market_no_vig_probability: number | null;
  readonly edge: number | null;
  readonly fair_american_odds: number | null;
}

export interface BettingEdgeBoardTopSide {
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

export interface BettingEdgeBoardSummary {
  readonly total_games: number;
  readonly ready_games: number;
  readonly held_games: number;
  readonly average_ready_edge: number | null;
  readonly top_edge_side: BettingEdgeBoardTopSide | null;
}

export interface BettingEdgeBoardCounts extends ScheduleBoardCounts {
  readonly moneyline_entries: number;
  readonly matched_markets: number;
}

export interface BettingEdgeBoardProjection {
  readonly blocked: BlockedState;
  readonly projected_away_runs: number | null;
  readonly projected_home_runs: number | null;
  readonly projected_total: number | null;
  readonly away_win_probability: number | null;
  readonly home_win_probability: number | null;
  /** Pitcher provenance — null when no starter is attached to the row. */
  readonly away_pitcher_baseline_source: "season_stats" | "league_average_fallback" | null;
  readonly home_pitcher_baseline_source: "season_stats" | "league_average_fallback" | null;
  readonly away_pitcher_identity_known: boolean | null;
  readonly home_pitcher_identity_known: boolean | null;
  readonly away_pitcher_fallback_reason: "pitcher_no_2026_stats" | "probable_pitcher_tbd" | null;
  readonly home_pitcher_fallback_reason: "pitcher_no_2026_stats" | "probable_pitcher_tbd" | null;
  readonly away_pitcher_fallback_used: boolean | null;
  readonly home_pitcher_fallback_used: boolean | null;
}

export interface BettingEdgeBoardRow {
  readonly game_id: GameId;
  readonly matchup: string;
  readonly scheduled_start: ISOTimestamp;
  readonly status: GameStatus;
  readonly venue_name: string | null;
  readonly away_team_abbreviation: string;
  readonly away_team_full_name: string;
  readonly home_team_abbreviation: string;
  readonly home_team_full_name: string;
  readonly projection: BettingEdgeBoardProjection;
  readonly draftkings_sportsbook_moneyline: {
    readonly provider: "draftkings-sportsbook";
    readonly sport: "MLB";
    readonly market_type: "moneyline";
    readonly event_id: string | null;
    readonly market_id: string | null;
    readonly away_odds_american: number | null;
    readonly home_odds_american: number | null;
    readonly away: BettingEdgeBoardMoneylineSide;
    readonly home: BettingEdgeBoardMoneylineSide;
    readonly blocked: BlockedState;
  };
}

export interface BettingEdgeBoardPayload {
  readonly source: string;
  readonly mode: "betting-edge-board-v1";
  readonly date: string;
  readonly generated_at: ISOTimestamp;
  readonly draftkings_sportsbook_moneyline: BettingEdgeBoardSportsbookSummary | null;
  readonly summary: BettingEdgeBoardSummary;
  readonly counts: BettingEdgeBoardCounts;
  readonly ready_games: readonly BettingEdgeBoardRow[];
  readonly held_games: readonly BettingEdgeBoardRow[];
  readonly note: string | null;
  /** Proof output: number of games where ≥1 starter used the league-average ERA fallback. */
  readonly pitcher_fallback_count: number;
  /** Proof output: game IDs where the league-average ERA fallback was applied. */
  readonly pitcher_fallback_game_ids: readonly GameId[];
}
