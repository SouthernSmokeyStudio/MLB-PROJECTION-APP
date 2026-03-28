import type { CanonicalGame, CanonicalSlate } from "@lib/contracts/canonical";
import type { CheckResult } from "@lib/contracts/checks";
import { createCheckResult } from "@lib/contracts/checks";
import type { PreparedGameInputs } from "@lib/contracts/prepared";

export const checkCanonicalGameSchema = (game: CanonicalGame): readonly CheckResult[] => {
  const results: CheckResult[] = [];

  if (!game.game_id) {
    results.push(createCheckResult("schema.canonical_game", false, "error", "game", null, "game_id is required"));
  }

  if (!game.away?.team?.team_id || !game.home?.team?.team_id) {
    results.push(createCheckResult("schema.canonical_game", false, "error", "game", game.game_id, "away and home team ids are required"));
  }

  if (results.length === 0) {
    results.push(createCheckResult("schema.canonical_game", true, "info", "game", game.game_id, "Canonical game schema valid"));
  }

  return results;
};

export const checkCanonicalSlateSchema = (slate: CanonicalSlate): readonly CheckResult[] => {
  const results: CheckResult[] = [];
  if (!Array.isArray(slate.games)) {
    results.push(createCheckResult("schema.canonical_slate", false, "error", "slate", null, "games must be an array"));
    return results;
  }

  for (const game of slate.games) {
    results.push(...checkCanonicalGameSchema(game));
  }

  if (results.length === 0) {
    results.push(createCheckResult("schema.canonical_slate", true, "info", "slate", null, "Canonical slate schema valid"));
  }

  return results;
};

export const checkPreparedGameSchema = (inputs: PreparedGameInputs): readonly CheckResult[] => {
  const results: CheckResult[] = [];

  if (!inputs.game_id) {
    results.push(createCheckResult("schema.prepared_game", false, "error", "prepared_input", null, "game_id is required"));
  }

  if (!Array.isArray(inputs.away_batters) || !Array.isArray(inputs.home_batters)) {
    results.push(createCheckResult("schema.prepared_game", false, "error", "prepared_input", inputs.game_id, "batter collections must be arrays"));
  }

  if (inputs.blocked.is_blocked && !inputs.blocked.blocked_reason) {
    results.push(createCheckResult("schema.prepared_game", false, "error", "prepared_input", inputs.game_id, "blocked_reason is required when is_blocked is true"));
  }

  if (results.length === 0) {
    results.push(createCheckResult("schema.prepared_game", true, "info", "prepared_input", inputs.game_id, "Prepared game schema valid"));
  }

  return results;
};
