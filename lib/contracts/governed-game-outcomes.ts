import type {
  DataFreshness,
  GameId,
  ISOTimestamp,
  RunId,
  SportId,
  TeamId
} from "./types";
import { SPORT_ID, asGameId, asISOTimestamp, asRunId, asTeamId } from "./types";

export const GOVERNED_REVIEW_STATUSES = ["APPROVED", "REJECTED"] as const;
export type GovernedReviewStatus = (typeof GOVERNED_REVIEW_STATUSES)[number];

export const GOVERNED_REVIEW_TIERS = ["TIER_1", "TIER_2"] as const;
export type GovernedReviewTier = (typeof GOVERNED_REVIEW_TIERS)[number];

export const CANDIDATE_SIDES = ["HOME", "AWAY"] as const;
export type CandidateSide = (typeof CANDIDATE_SIDES)[number];

export const GOVERNED_GAME_OUTCOME_COLUMNS = [
  "game_id",
  "sport_id",
  "away_team_id",
  "home_team_id",
  "candidate_side",
  "predicted_home_win_probability",
  "review_tier",
  "review_status",
  "review_decision_reason",
  "run_id",
  "generated_at_utc",
  "is_stale",
  "stale_reason"
] as const;

export const GOVERNED_GAME_OUTCOME_SELECT = GOVERNED_GAME_OUTCOME_COLUMNS.join(", ");

export interface GovernedGameOutcomeRow
  extends Pick<DataFreshness, "is_stale" | "stale_reason"> {
  readonly game_id: GameId;
  readonly sport_id: SportId;
  readonly away_team_id: TeamId;
  readonly home_team_id: TeamId;
  readonly candidate_side: CandidateSide;
  readonly predicted_home_win_probability: number;
  readonly review_tier: GovernedReviewTier;
  readonly review_status: GovernedReviewStatus;
  readonly review_decision_reason: string | null;
  readonly run_id: RunId;
  readonly generated_at_utc: ISOTimestamp;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readRequiredString = (record: Record<string, unknown>, fieldName: string): string => {
  const value = record[fieldName];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Governed game outcomes row is missing ${fieldName}.`);
  }

  return value;
};

const readNullableString = (record: Record<string, unknown>, fieldName: string): string | null => {
  const value = record[fieldName];

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`Governed game outcomes row has invalid ${fieldName}.`);
  }

  return value;
};

const readRequiredBoolean = (record: Record<string, unknown>, fieldName: string): boolean => {
  const value = record[fieldName];

  if (typeof value !== "boolean") {
    throw new Error(`Governed game outcomes row has invalid ${fieldName}.`);
  }

  return value;
};

const readRequiredNumber = (record: Record<string, unknown>, fieldName: string): number => {
  const value = record[fieldName];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Governed game outcomes row has invalid ${fieldName}.`);
  }

  return value;
};

const isCandidateSide = (value: string): value is CandidateSide =>
  (CANDIDATE_SIDES as readonly string[]).includes(value);

const isGovernedReviewTier = (value: string): value is GovernedReviewTier =>
  (GOVERNED_REVIEW_TIERS as readonly string[]).includes(value);

const isGovernedReviewStatus = (value: string): value is GovernedReviewStatus =>
  (GOVERNED_REVIEW_STATUSES as readonly string[]).includes(value);

export const parseGovernedGameOutcomeRow = (value: unknown): GovernedGameOutcomeRow => {
  if (!isRecord(value)) {
    throw new Error("Governed game outcomes row must be an object.");
  }

  const sportId = readRequiredString(value, "sport_id");
  if (sportId !== SPORT_ID) {
    throw new Error(`Governed game outcomes row has invalid sport_id ${sportId}.`);
  }

  const candidateSide = readRequiredString(value, "candidate_side");
  if (!isCandidateSide(candidateSide)) {
    throw new Error(`Governed game outcomes row has invalid candidate_side ${candidateSide}.`);
  }

  const reviewTier = readRequiredString(value, "review_tier");
  if (!isGovernedReviewTier(reviewTier)) {
    throw new Error(`Governed game outcomes row has invalid review_tier ${reviewTier}.`);
  }

  const reviewStatus = readRequiredString(value, "review_status");
  if (!isGovernedReviewStatus(reviewStatus)) {
    throw new Error(`Governed game outcomes row has invalid review_status ${reviewStatus}.`);
  }

  return {
    game_id: asGameId(readRequiredString(value, "game_id")),
    sport_id: SPORT_ID,
    away_team_id: asTeamId(readRequiredString(value, "away_team_id")),
    home_team_id: asTeamId(readRequiredString(value, "home_team_id")),
    candidate_side: candidateSide,
    predicted_home_win_probability: readRequiredNumber(
      value,
      "predicted_home_win_probability"
    ),
    review_tier: reviewTier,
    review_status: reviewStatus,
    review_decision_reason: readNullableString(value, "review_decision_reason"),
    run_id: asRunId(readRequiredString(value, "run_id")),
    generated_at_utc: asISOTimestamp(readRequiredString(value, "generated_at_utc")),
    is_stale: readRequiredBoolean(value, "is_stale"),
    stale_reason: readNullableString(value, "stale_reason")
  };
};

export const parseGovernedGameOutcomeRows = (
  values: readonly unknown[]
): readonly GovernedGameOutcomeRow[] => values.map(parseGovernedGameOutcomeRow);
