export type Brand<T, TBrand extends string> = T & { readonly __brand: TBrand };

export type GameId = Brand<string, "GameId">;
export type TeamId = Brand<string, "TeamId">;
export type PlayerId = Brand<string, "PlayerId">;
export type VenueId = Brand<string, "VenueId">;
export type RunId = Brand<string, "RunId">;
export type ISOTimestamp = Brand<string, "ISOTimestamp">;

export type SportId = "MLB";
export type GameStatus =
  | "scheduled"
  | "pregame"
  | "in_progress"
  | "delayed"
  | "suspended"
  | "final"
  | "postponed"
  | "cancelled"
  | "unknown";

export type PlayerPosition =
  | "P"
  | "C"
  | "1B"
  | "2B"
  | "3B"
  | "SS"
  | "LF"
  | "CF"
  | "RF"
  | "DH"
  | "UTIL"
  | "unknown";

export type Handedness = "L" | "R" | "S" | "unknown";
export type StartingStatus = "confirmed" | "expected" | "probable" | "unknown";
export type CheckSeverity = "error" | "warning" | "info";
export type EntityType =
  | "game"
  | "team"
  | "player"
  | "batter"
  | "pitcher"
  | "venue"
  | "prepared_input"
  | "slate";

export interface SourceMetadata {
  readonly provider: string;
  readonly endpoint: string;
  readonly fetched_at: ISOTimestamp;
  readonly raw_payload_hash: string | null;
}

export interface DataFreshness {
  readonly is_stale: boolean;
  readonly stale_reason: string | null;
  readonly last_synced: ISOTimestamp;
}

export interface BlockedState {
  readonly is_blocked: boolean;
  readonly blocked_reason: string | null;
}

export interface VersionInfo {
  readonly model_version: string;
  readonly feature_set_version: string;
  readonly scoring_version: string;
  readonly data_version: string;
}

export interface WeatherSummary {
  readonly temperature_f: number | null;
  readonly wind_speed_mph: number | null;
  readonly wind_direction: string | null;
  readonly precipitation_chance: number | null;
  readonly conditions: string | null;
  readonly dome_closed: boolean | null;
}

export interface RawPayloadContainer {
  readonly id: string;
  readonly provider: string;
  readonly endpoint: string;
  readonly fetched_at: ISOTimestamp;
  readonly payload: Record<string, unknown>;
  readonly checksum: string;
}

export type Result<T, E = string> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E };

export const SPORT_ID: SportId = "MLB";

export const asGameId = (value: string): GameId => value as GameId;
export const asTeamId = (value: string): TeamId => value as TeamId;
export const asPlayerId = (value: string): PlayerId => value as PlayerId;
export const asVenueId = (value: string): VenueId => value as VenueId;
export const asRunId = (value: string): RunId => value as RunId;
export const asISOTimestamp = (value: string): ISOTimestamp => value as ISOTimestamp;

export const nowISO = (): ISOTimestamp => new Date().toISOString() as ISOTimestamp;
export const ok = <T>(data: T): Result<T, never> => ({ success: true, data });
export const err = <E>(error: E): Result<never, E> => ({ success: false, error });
