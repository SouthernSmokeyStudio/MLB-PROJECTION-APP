import type { GameId, ISOTimestamp, PlayerId, SourceMetadata, TeamId } from "./types";

export interface ActualTeamOutcome {
  readonly team_id: TeamId;
  readonly runs: number;
  readonly hits: number;
  readonly errors: number;
  readonly left_on_base: number;
}

export interface ActualGameOutcome {
  readonly game_id: GameId;
  readonly played_at: ISOTimestamp;
  readonly away: ActualTeamOutcome;
  readonly home: ActualTeamOutcome;
  readonly total_runs: number;
  readonly total_innings: number;
  readonly is_complete: boolean;
  readonly was_postponed: boolean;
  readonly was_suspended: boolean;
  readonly sources: readonly SourceMetadata[];
}

export interface ActualPlayerOutcome {
  readonly player_id: PlayerId;
  readonly team_id: TeamId;
  readonly game_id: GameId;
  readonly pa: number | null;
  readonly ip: number | null;
  readonly strikeouts: number | null;
  readonly earned_runs: number | null;
  readonly hits: number | null;
  readonly runs: number | null;
  readonly rbi: number | null;
  readonly walks: number | null;
  readonly stolen_bases: number | null;
}

export interface ActualFantasyOutcome {
  readonly player_id: PlayerId;
  readonly game_id: GameId;
  readonly platform: "draftkings" | "fanduel";
  readonly contest_type: "classic" | "showdown";
  readonly actual_points: number;
  readonly salary: number | null;
}
