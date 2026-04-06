import type { ProjectionMetadata } from "./projections";
import type {
  BlockedState,
  GameId,
  ISOTimestamp,
  RunId,
  VersionInfo
} from "./types";

export interface ProjectionLineage {
  readonly game_id: GameId;
  readonly prepared_at: ISOTimestamp;
  readonly run_id: RunId;
  readonly projected_at: ISOTimestamp;
  readonly model_version: VersionInfo["model_version"];
  readonly feature_set_version: VersionInfo["feature_set_version"];
  readonly scoring_version: VersionInfo["scoring_version"];
  readonly data_version: VersionInfo["data_version"];
  readonly blocked: BlockedState;
}

export interface ProjectionReconciliationChecks {
  readonly game_id_match: boolean;
  readonly run_id_match: boolean;
  readonly projected_at_match: boolean;
  readonly version_fields_match: boolean;
  readonly blocked_state_consistency: boolean;
  readonly player_team_membership_valid: boolean;
  readonly pitcher_role_shape_valid: boolean;
}

export interface ProjectionReconciliationResult {
  readonly game_id: GameId;
  readonly passed: boolean;
  readonly checks: ProjectionReconciliationChecks;
  readonly failures: readonly string[];
}

export const createProjectionLineage = ({
  game_id,
  prepared_at,
  metadata
}: {
  readonly game_id: GameId;
  readonly prepared_at: ISOTimestamp;
  readonly metadata: ProjectionMetadata;
}): ProjectionLineage => ({
  game_id,
  prepared_at,
  run_id: metadata.run_id,
  projected_at: metadata.projected_at,
  model_version: metadata.version.model_version,
  feature_set_version: metadata.version.feature_set_version,
  scoring_version: metadata.version.scoring_version,
  data_version: metadata.version.data_version,
  blocked: metadata.blocked
});
