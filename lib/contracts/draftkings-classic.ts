import type { BlockedState, ISOTimestamp, PlayerId, SourceMetadata } from "./types";

export interface DraftKingsClassicDraftGroup {
  readonly draft_group_id: string;
  readonly sport_id: number;
  readonly contest_type_id: number;
  readonly game_type_id: number;
  readonly draft_group_state: string;
  readonly sort_order: number;
  readonly start_time_suffix: string | null;
  readonly min_start_time: ISOTimestamp;
  readonly max_start_time: ISOTimestamp;
  readonly allow_lineup_creation: boolean;
  readonly all_tags: readonly string[];
  readonly competition_ids: readonly string[];
}

export interface DraftKingsClassicSalaryEntry {
  readonly draftable_id: string;
  readonly player_id: PlayerId;
  readonly player_dk_id: string;
  readonly display_name: string;
  readonly short_name: string;
  readonly position: string;
  readonly roster_slot_id: number;
  readonly salary: number;
  readonly team_abbreviation: string;
  readonly competition_id: string;
  readonly competition_name: string;
  readonly competition_start: ISOTimestamp;
}

export interface DraftKingsClassicSalarySlate {
  readonly provider: "draftkings";
  readonly contest_type: "classic";
  readonly draft_group_id: string;
  readonly source: SourceMetadata;
  readonly salaries: readonly DraftKingsClassicSalaryEntry[];
}

export interface DraftKingsClassicJoinState {
  readonly platform: "draftkings";
  readonly contest_type: "classic";
  readonly draft_group_id: string;
  readonly draftable_id: string | null;
  readonly blocked: BlockedState;
}
