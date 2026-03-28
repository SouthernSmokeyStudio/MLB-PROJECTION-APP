import type {
  BlockedState,
  GameId,
  ISOTimestamp,
  PlayerId,
  RunId,
  SportId,
  TeamId,
  VersionInfo
} from "./types";

export interface ProjectionMetadata {
  readonly run_id: RunId;
  readonly projected_at: ISOTimestamp;
  readonly version: VersionInfo;
  readonly model_confidence: number | null;
  readonly sources_used: readonly string[];
  readonly blocked: BlockedState;
}

export interface TeamProjection {
  readonly team_id: TeamId;
  readonly projected_runs: number;
  readonly projected_runs_std: number | null;
  readonly win_probability: number | null;
}

export interface GameProjection {
  readonly game_id: GameId;
  readonly sport_id: SportId;
  readonly metadata: ProjectionMetadata;
  readonly away: TeamProjection;
  readonly home: TeamProjection;
  readonly projected_total: number;
  readonly projected_total_std: number | null;
  readonly over_probability: number | null;
  readonly under_probability: number | null;
}

export interface PitcherProjection {
  readonly player_id: PlayerId;
  readonly team_id: TeamId;
  readonly game_id: GameId;
  readonly projected_ip: number;
  readonly projected_ip_std: number | null;
  readonly projected_k: number;
  readonly projected_k_std: number | null;
  readonly projected_er: number;
  readonly projected_er_std: number | null;
  readonly projected_hits: number;
  readonly projected_bb: number;
  readonly win_probability: number | null;
  readonly quality_start_probability: number | null;
}

export interface BatterProjection {
  readonly player_id: PlayerId;
  readonly team_id: TeamId;
  readonly game_id: GameId;
  readonly projected_pa: number;
  readonly projected_ab: number;
  readonly projected_hits: number;
  readonly projected_singles: number;
  readonly projected_doubles: number;
  readonly projected_triples: number;
  readonly projected_hr: number;
  readonly projected_rbi: number;
  readonly projected_runs: number;
  readonly projected_bb: number;
  readonly projected_sb: number;
}

export interface PlayerFantasyProjection {
  readonly player_id: PlayerId;
  readonly team_id: TeamId;
  readonly game_id: GameId;
  readonly platform: "draftkings" | "fanduel";
  readonly contest_type: "classic" | "showdown";
  readonly projected_points: number;
  readonly projected_points_std: number | null;
  readonly ceiling: number | null;
  readonly floor: number | null;
  readonly salary: number | null;
  readonly value: number | null;
}
