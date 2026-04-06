import type { BlockedState, ISOTimestamp, SourceMetadata } from "./types";

export interface DraftKingsSportsbookMlbMoneylineEntry {
  readonly event_id: string;
  readonly market_id: string;
  readonly event_name: string;
  readonly start_time: ISOTimestamp;
  readonly away_team_abbreviation: string;
  readonly away_team_name: string;
  readonly away_starting_pitcher: string | null;
  readonly home_team_abbreviation: string;
  readonly home_team_name: string;
  readonly home_starting_pitcher: string | null;
  readonly away_odds_american: number;
  readonly away_odds_decimal: number | null;
  readonly home_odds_american: number;
  readonly home_odds_decimal: number | null;
}

export interface DraftKingsSportsbookMlbMoneylineSlate {
  readonly provider: "draftkings-sportsbook";
  readonly sport: "MLB";
  readonly market_type: "moneyline";
  readonly site: "US-TN-SB";
  readonly league_id: string;
  readonly subcategory_id: string;
  readonly source: SourceMetadata;
  readonly entries: readonly DraftKingsSportsbookMlbMoneylineEntry[];
}

export interface DraftKingsSportsbookMlbMoneylineJoinState {
  readonly provider: "draftkings-sportsbook";
  readonly sport: "MLB";
  readonly market_type: "moneyline";
  readonly event_id: string | null;
  readonly market_id: string | null;
  readonly away_odds_american: number | null;
  readonly home_odds_american: number | null;
  readonly blocked: BlockedState;
}
