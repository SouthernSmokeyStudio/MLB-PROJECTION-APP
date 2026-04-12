import type { Result } from "@lib/contracts/types";

export interface MlbStatsApiGameStatus {
  readonly codedGameState: string | null;
  readonly detailedState: string | null;
}

export interface MlbStatsApiProbablePitcher {
  readonly id: number;
  readonly fullName: string | null;
}

export interface MlbStatsApiTeamReference {
  readonly id: number;
  readonly name: string;
}

export interface MlbStatsApiTeamSide {
  readonly team: MlbStatsApiTeamReference;
  readonly probablePitcher: MlbStatsApiProbablePitcher | null;
}

export interface MlbStatsApiScheduleTeams {
  readonly away: MlbStatsApiTeamSide;
  readonly home: MlbStatsApiTeamSide;
}

export interface MlbStatsApiVenue {
  readonly id: number;
  readonly name: string;
}

export interface MlbStatsApiLinescoreTeam {
  readonly runs: number | null;
}

export interface MlbStatsApiLinescore {
  readonly currentInning: number | null;
  readonly currentInningOrdinal: string | null;
  readonly inningState: string | null;
  readonly inningHalf: string | null;
  readonly isTopInning: boolean | null;
  readonly teams: {
    readonly away: MlbStatsApiLinescoreTeam;
    readonly home: MlbStatsApiLinescoreTeam;
  };
}

export interface MlbStatsApiScheduleGame {
  readonly gamePk: number;
  readonly gameDate: string;
  /**
   * The official local (Eastern) date for this game as returned by the MLB
   * Stats API — e.g. "2026-04-11".  Late West Coast games that start after
   * midnight UTC have a gameDate UTC-date of T+1, but officialDate correctly
   * reflects the Eastern calendar date that MLB, DraftKings, and Rotowire all
   * use.  Falls back to the UTC date slice of gameDate when absent.
   */
  readonly officialDate: string;
  readonly status: MlbStatsApiGameStatus;
  readonly teams: MlbStatsApiScheduleTeams;
  readonly venue: MlbStatsApiVenue | null;
}

export interface MlbStatsApiGameAdapter {
  readonly source: "mlb-statsapi";
  parseGamePayload(payload: unknown): Result<MlbStatsApiScheduleGame, string>;
}
