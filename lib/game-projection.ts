/**
 * Validator for AssembledGameProjection — the latest_game_projection_truth.
 *
 * This file is the schema lock for per-game projection output. It mirrors the
 * pattern of lib/schedule-board.ts, lib/player-board.ts and lib/slate-snapshot.ts:
 * every exported parse function takes unknown input, throws on any deviation from
 * the contracts in lib/contracts/projections.ts, and returns the fully-typed value.
 *
 * Schema source: lib/projections/assembleGameProjection.ts →
 *   AssembledGameProjection (lib/projections/assembleGameProjection.ts)
 *
 * Allowed null fields (per contracts):
 *   projected_runs_std, projected_total_std, over_probability, under_probability,
 *   win_probability (team and pitcher), quality_start_probability,
 *   projected_ip_std, projected_k_std, projected_er_std,
 *   model_confidence, away_pitcher, home_pitcher
 *
 * Never-null fields (assembleGameProjection defaults to 0 when blocked):
 *   projected_runs (both teams), projected_total
 */

import type { AssembledGameProjection } from "@lib/projections/assembleGameProjection";
import type {
  BatterProjection,
  GameProjection,
  PitcherProjection,
  ProjectionMetadata,
  TeamProjection
} from "@lib/contracts/projections";
import {
  asGameId,
  asISOTimestamp,
  asPlayerId,
  asRunId,
  asTeamId,
  type BlockedState,
  type VersionInfo
} from "@lib/contracts/types";

// ---------------------------------------------------------------------------
// Internal helpers — identical in style to lib/schedule-board.ts
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertNoExtraneousKeys = (
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string
): void => {
  const extra = Object.keys(record).filter(k => !allowedKeys.includes(k));
  if (extra.length > 0) {
    throw new Error(`${label} has extraneous field(s): ${extra.join(", ")}.`);
  }
};

const readString = (record: Record<string, unknown>, fieldName: string): string => {
  const value = record[fieldName];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Game projection is missing ${fieldName}.`);
  }
  return value;
};

const readNumber = (record: Record<string, unknown>, fieldName: string): number => {
  const value = record[fieldName];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Game projection has invalid ${fieldName}.`);
  }
  return value;
};

const readNullableNumber = (
  record: Record<string, unknown>,
  fieldName: string
): number | null => {
  const value = record[fieldName];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Game projection has invalid ${fieldName}.`);
  }
  return value;
};

const readBoolean = (record: Record<string, unknown>, fieldName: string): boolean => {
  const value = record[fieldName];
  if (typeof value !== "boolean") {
    throw new Error(`Game projection has invalid ${fieldName}.`);
  }
  return value;
};

const readNullableString = (
  record: Record<string, unknown>,
  fieldName: string
): string | null => {
  const value = record[fieldName];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error(`Game projection has invalid ${fieldName}.`);
  }
  return value;
};

// ---------------------------------------------------------------------------
// Sub-parsers
// ---------------------------------------------------------------------------

const BLOCKED_STATE_KEYS = ["is_blocked", "blocked_reason"] as const;

const parseBlockedState = (value: unknown): BlockedState => {
  if (!isRecord(value)) {
    throw new Error("Game projection metadata.blocked must be an object.");
  }
  assertNoExtraneousKeys(value, BLOCKED_STATE_KEYS, "metadata.blocked");
  return {
    is_blocked: readBoolean(value, "is_blocked"),
    blocked_reason: readNullableString(value, "blocked_reason")
  };
};

const VERSION_INFO_KEYS = ["model_version", "feature_set_version", "scoring_version", "data_version"] as const;

const parseVersionInfo = (value: unknown): VersionInfo => {
  if (!isRecord(value)) {
    throw new Error("Game projection metadata.version must be an object.");
  }
  assertNoExtraneousKeys(value, VERSION_INFO_KEYS, "metadata.version");
  return {
    model_version: readString(value, "model_version"),
    feature_set_version: readString(value, "feature_set_version"),
    scoring_version: readString(value, "scoring_version"),
    data_version: readString(value, "data_version")
  };
};

const PROJECTION_METADATA_KEYS = [
  "run_id", "projected_at", "version", "model_confidence", "sources_used", "blocked"
] as const;

const parseProjectionMetadata = (value: unknown): ProjectionMetadata => {
  if (!isRecord(value)) {
    throw new Error("Game projection metadata must be an object.");
  }
  assertNoExtraneousKeys(value, PROJECTION_METADATA_KEYS, "metadata");

  const sourcesUsed = value.sources_used;
  if (!Array.isArray(sourcesUsed)) {
    throw new Error("Game projection metadata.sources_used must be an array.");
  }
  const parsedSources = sourcesUsed.map((entry, i) => {
    if (typeof entry !== "string") {
      throw new Error(`Game projection metadata.sources_used[${i}] must be a string.`);
    }
    return entry;
  });

  return {
    run_id: asRunId(readString(value, "run_id")),
    projected_at: asISOTimestamp(readString(value, "projected_at")),
    version: parseVersionInfo(value.version),
    model_confidence: readNullableNumber(value, "model_confidence"),
    sources_used: parsedSources,
    blocked: parseBlockedState(value.blocked)
  };
};

const TEAM_PROJECTION_KEYS = [
  "team_id", "projected_runs", "projected_runs_std", "win_probability"
] as const;

const parseTeamProjection = (value: unknown): TeamProjection => {
  if (!isRecord(value)) {
    throw new Error("Game projection team block must be an object.");
  }
  assertNoExtraneousKeys(value, TEAM_PROJECTION_KEYS, "team");
  return {
    team_id: asTeamId(readString(value, "team_id")),
    projected_runs: readNumber(value, "projected_runs"),
    projected_runs_std: readNullableNumber(value, "projected_runs_std"),
    win_probability: readNullableNumber(value, "win_probability")
  };
};

const PITCHER_PROJECTION_KEYS = [
  "player_id", "team_id", "game_id", "projected_ip", "projected_ip_std",
  "projected_k", "projected_k_std", "projected_er", "projected_er_std",
  "projected_hits", "projected_bb", "win_probability", "quality_start_probability"
] as const;

const parsePitcherProjection = (value: unknown): PitcherProjection => {
  if (!isRecord(value)) {
    throw new Error("Game projection pitcher block must be an object.");
  }
  assertNoExtraneousKeys(value, PITCHER_PROJECTION_KEYS, "pitcher");
  return {
    player_id: asPlayerId(readString(value, "player_id")),
    team_id: asTeamId(readString(value, "team_id")),
    game_id: asGameId(readString(value, "game_id")),
    projected_ip: readNumber(value, "projected_ip"),
    projected_ip_std: readNullableNumber(value, "projected_ip_std"),
    projected_k: readNumber(value, "projected_k"),
    projected_k_std: readNullableNumber(value, "projected_k_std"),
    projected_er: readNumber(value, "projected_er"),
    projected_er_std: readNullableNumber(value, "projected_er_std"),
    projected_hits: readNumber(value, "projected_hits"),
    projected_bb: readNumber(value, "projected_bb"),
    win_probability: readNullableNumber(value, "win_probability"),
    quality_start_probability: readNullableNumber(value, "quality_start_probability")
  };
};

const parseNullablePitcherProjection = (value: unknown): PitcherProjection | null => {
  if (value === null || value === undefined) return null;
  return parsePitcherProjection(value);
};

const BATTER_PROJECTION_KEYS = [
  "player_id", "team_id", "game_id", "projected_pa", "projected_ab",
  "projected_hits", "projected_singles", "projected_doubles", "projected_triples",
  "projected_hr", "projected_rbi", "projected_runs", "projected_bb", "projected_sb"
] as const;

const parseBatterProjection = (value: unknown): BatterProjection => {
  if (!isRecord(value)) {
    throw new Error("Game projection batter block must be an object.");
  }
  assertNoExtraneousKeys(value, BATTER_PROJECTION_KEYS, "batter");
  return {
    player_id: asPlayerId(readString(value, "player_id")),
    team_id: asTeamId(readString(value, "team_id")),
    game_id: asGameId(readString(value, "game_id")),
    projected_pa: readNumber(value, "projected_pa"),
    projected_ab: readNumber(value, "projected_ab"),
    projected_hits: readNumber(value, "projected_hits"),
    projected_singles: readNumber(value, "projected_singles"),
    projected_doubles: readNumber(value, "projected_doubles"),
    projected_triples: readNumber(value, "projected_triples"),
    projected_hr: readNumber(value, "projected_hr"),
    projected_rbi: readNumber(value, "projected_rbi"),
    projected_runs: readNumber(value, "projected_runs"),
    projected_bb: readNumber(value, "projected_bb"),
    projected_sb: readNumber(value, "projected_sb")
  };
};

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

/**
 * Validates and returns a fully-typed GameProjection.
 * Throws with a descriptive message on any schema violation.
 */
const GAME_PROJECTION_KEYS = [
  "game_id", "sport_id", "metadata", "away", "home",
  "projected_total", "projected_total_std", "over_probability", "under_probability"
] as const;

export const parseGameProjection = (value: unknown): GameProjection => {
  if (!isRecord(value)) {
    throw new Error("Game projection must be an object.");
  }
  assertNoExtraneousKeys(value, GAME_PROJECTION_KEYS, "game_projection");

  const sportId = value.sport_id;
  if (sportId !== "MLB") {
    throw new Error(
      `Game projection sport_id must be "MLB"; received ${JSON.stringify(sportId)}.`
    );
  }

  return {
    game_id: asGameId(readString(value, "game_id")),
    sport_id: "MLB",
    metadata: parseProjectionMetadata(value.metadata),
    away: parseTeamProjection(value.away),
    home: parseTeamProjection(value.home),
    projected_total: readNumber(value, "projected_total"),
    projected_total_std: readNullableNumber(value, "projected_total_std"),
    over_probability: readNullableNumber(value, "over_probability"),
    under_probability: readNullableNumber(value, "under_probability")
  };
};

/**
 * Validates and returns a fully-typed AssembledGameProjection.
 * This is the schema lock for latest_game_projection_truth.
 * Throws with a descriptive message on any schema violation.
 */
const ASSEMBLED_ROOT_KEYS = [
  "game_projection", "away_pitcher", "home_pitcher", "away_batters", "home_batters", "team_runs_blocked"
] as const;

export const parseAssembledGameProjection = (value: unknown): AssembledGameProjection => {
  if (!isRecord(value)) {
    throw new Error("Assembled game projection must be an object.");
  }
  assertNoExtraneousKeys(value, ASSEMBLED_ROOT_KEYS, "assembled root");

  const awayBattersRaw = value.away_batters;
  const homeBattersRaw = value.home_batters;

  if (!Array.isArray(awayBattersRaw)) {
    throw new Error("Assembled game projection away_batters must be an array.");
  }
  if (!Array.isArray(homeBattersRaw)) {
    throw new Error("Assembled game projection home_batters must be an array.");
  }

  if (typeof value.team_runs_blocked !== "boolean") {
    throw new Error("Assembled game projection team_runs_blocked must be a boolean.");
  }

  return {
    game_projection: parseGameProjection(value.game_projection),
    away_pitcher: parseNullablePitcherProjection(value.away_pitcher),
    home_pitcher: parseNullablePitcherProjection(value.home_pitcher),
    away_batters: awayBattersRaw.map((entry, i) => {
      try {
        return parseBatterProjection(entry);
      } catch (err) {
        throw new Error(
          `Assembled game projection away_batters[${i}]: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }),
    home_batters: homeBattersRaw.map((entry, i) => {
      try {
        return parseBatterProjection(entry);
      } catch (err) {
        throw new Error(
          `Assembled game projection home_batters[${i}]: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }),
    team_runs_blocked: value.team_runs_blocked as boolean
  };
};
