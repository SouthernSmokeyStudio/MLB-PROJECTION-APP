import type { PostgrestError } from "@supabase/supabase-js";
import {
  GOVERNED_GAME_OUTCOME_SELECT,
  parseGovernedGameOutcomeRows,
  type GovernedGameOutcomeRow,
  type GovernedReviewStatus
} from "@lib/contracts/governed-game-outcomes";
import { SPORT_ID, type SportId } from "@lib/contracts/types";
import { getSupabaseReadClient } from "./client";

const GOVERNED_GAME_OUTCOMES_TABLE = "governed_game_outcomes";
const DEFAULT_REVIEW_STATUS: GovernedReviewStatus = "APPROVED";

export interface ReadGovernedGameOutcomesOptions {
  readonly sport_id?: SportId;
  readonly include_stale?: boolean;
  readonly review_status?: GovernedReviewStatus | "ALL";
}

interface SupabaseQueryResult {
  readonly data: unknown;
  readonly error: PostgrestError | null;
}

export const readGovernedGameOutcomes = async (
  options: ReadGovernedGameOutcomesOptions = {}
): Promise<readonly GovernedGameOutcomeRow[]> => {
  const client = getSupabaseReadClient();
  const sportId = options.sport_id ?? SPORT_ID;
  const reviewStatus = options.review_status ?? DEFAULT_REVIEW_STATUS;

  let query = client
    .from(GOVERNED_GAME_OUTCOMES_TABLE)
    .select(GOVERNED_GAME_OUTCOME_SELECT)
    .eq("sport_id", sportId);

  if (!options.include_stale) {
    query = query.eq("is_stale", false);
  }

  if (reviewStatus !== "ALL") {
    query = query.eq("review_status", reviewStatus);
  }

  query = query
    .order("generated_at_utc", { ascending: false })
    .order("game_id", { ascending: true });

  const { data, error } = (await query) as SupabaseQueryResult;

  if (error) {
    throw new Error(`Failed to read governed game outcomes: ${error.message}`);
  }

  if (!Array.isArray(data)) {
    throw new Error("Failed to read governed game outcomes: response was not an array.");
  }

  return parseGovernedGameOutcomeRows(data);
};
