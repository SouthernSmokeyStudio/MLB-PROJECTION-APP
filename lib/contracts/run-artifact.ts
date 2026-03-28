import type { RunId, ISOTimestamp, VersionInfo } from "./types";
import type { CheckSummary } from "./checks";

export interface RunArtifact {
  readonly run_id: RunId;
  readonly generated_at: ISOTimestamp;
  readonly version: VersionInfo;
  readonly inputs: {
    readonly date: string;
    readonly games_attempted: number;
    readonly games_prepared: number;
    readonly games_blocked: number;
  };
  readonly checks: CheckSummary;
  readonly outputs: {
    readonly games_projected: number;
    readonly players_projected: number;
    readonly fantasy_projections: number;
  };
  readonly evaluation: null;
}
