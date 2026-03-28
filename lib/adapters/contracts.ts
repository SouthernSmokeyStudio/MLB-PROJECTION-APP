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

export interface MlbStatsApiScheduleGame {
  readonly gamePk: number;
  readonly gameDate: string;
  readonly status: MlbStatsApiGameStatus;
  readonly teams: MlbStatsApiScheduleTeams;
  readonly venue: MlbStatsApiVenue | null;
}

export interface MlbStatsApiGameAdapter {
  readonly source: "mlb-statsapi";
  parseGamePayload(payload: unknown): Result<MlbStatsApiScheduleGame, string>;
}
