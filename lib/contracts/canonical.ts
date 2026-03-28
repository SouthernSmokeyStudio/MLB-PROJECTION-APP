import type {
  DataFreshness,
  GameId,
  GameStatus,
  Handedness,
  ISOTimestamp,
  PlayerId,
  PlayerPosition,
  SourceMetadata,
  SportId,
  StartingStatus,
  TeamId,
  VenueId,
  WeatherSummary
} from "./types";
import { SPORT_ID } from "./types";

export interface CanonicalVenue {
  readonly venue_id: VenueId;
  readonly name: string;
  readonly city: string | null;
  readonly state: string | null;
  readonly country: string;
  readonly is_dome: boolean | null;
  readonly is_retractable_roof: boolean | null;
  readonly park_factor_runs: number | null;
}

export interface CanonicalTeam {
  readonly team_id: TeamId;
  readonly sport_id: SportId;
  readonly abbreviation: string;
  readonly full_name: string;
  readonly league: "AL" | "NL" | null;
  readonly division: "East" | "Central" | "West" | null;
}

export interface CanonicalPlayer {
  readonly player_id: PlayerId;
  readonly team_id: TeamId;
  readonly sport_id: SportId;
  readonly full_name: string;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly position: PlayerPosition;
  readonly bats: Handedness;
  readonly throws: Handedness;
  readonly jersey_number: string | null;
  readonly is_active: boolean;
  readonly source: SourceMetadata;
  readonly freshness: DataFreshness;
}

export interface LineupEntry {
  readonly player_id: PlayerId;
  readonly batting_order: number | null;
  readonly starting_status: StartingStatus;
  readonly position: PlayerPosition;
}

export interface ProbablePitcher {
  readonly player_id: PlayerId;
  readonly starting_status: StartingStatus;
  readonly handedness: Handedness;
}

export interface TeamGameContext {
  readonly team: CanonicalTeam;
  readonly probable_pitcher: ProbablePitcher | null;
  readonly lineup: readonly LineupEntry[] | null;
  readonly lineup_confirmed: boolean;
}

export interface CanonicalGame {
  readonly game_id: GameId;
  readonly sport_id: SportId;
  readonly scheduled_start: ISOTimestamp;
  readonly status: GameStatus;
  readonly away: TeamGameContext;
  readonly home: TeamGameContext;
  readonly venue: CanonicalVenue | null;
  readonly weather: WeatherSummary | null;
  readonly sources: readonly SourceMetadata[];
  readonly freshness: DataFreshness;
  readonly raw_payload_refs: readonly string[];
}

export interface CanonicalSlate {
  readonly sport_id: SportId;
  readonly date: string;
  readonly games: readonly CanonicalGame[];
  readonly generated_at: ISOTimestamp;
  readonly sources: readonly SourceMetadata[];
}

export const createCanonicalGame = (
  partial: Omit<CanonicalGame, "sport_id">
): CanonicalGame => ({
  ...partial,
  sport_id: SPORT_ID
});
