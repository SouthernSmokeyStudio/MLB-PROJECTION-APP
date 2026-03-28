import { createCheckResult, type CheckResult } from "@lib/contracts/checks";
import type { CanonicalGame } from "@lib/contracts/canonical";
import type { PreparedGameInputs } from "@lib/contracts/prepared";

const validDate = (value: string): boolean => !Number.isNaN(new Date(value).getTime());

export const checkCanonicalGameTemporal = (
  game: CanonicalGame,
  referenceTime: Date = new Date()
): readonly CheckResult[] => {
  const results: CheckResult[] = [];

  if (!validDate(game.scheduled_start)) {
    results.push(createCheckResult("temporal.canonical_game", false, "error", "game", game.game_id, "scheduled_start must be a valid timestamp"));
  }

  if (!validDate(game.freshness.last_synced)) {
    results.push(createCheckResult("temporal.canonical_game", false, "error", "game", game.game_id, "last_synced must be a valid timestamp"));
  }

  if (validDate(game.freshness.last_synced) && new Date(game.freshness.last_synced) > referenceTime) {
    results.push(createCheckResult("temporal.canonical_game", false, "error", "game", game.game_id, "last_synced cannot be in the future"));
  }

  if (results.length === 0) {
    results.push(createCheckResult("temporal.canonical_game", true, "info", "game", game.game_id, "Canonical temporal checks valid"));
  }

  return results;
};

export const checkPreparedGameTemporal = (
  inputs: PreparedGameInputs,
  referenceTime: Date = new Date()
): readonly CheckResult[] => {
  const results: CheckResult[] = [];

  if (!validDate(inputs.scheduled_start) || !validDate(inputs.prepared_at)) {
    results.push(createCheckResult("temporal.prepared_game", false, "error", "prepared_input", inputs.game_id, "timestamps must be valid ISO strings"));
    return results;
  }

  const preparedAt = new Date(inputs.prepared_at);
  const scheduledStart = new Date(inputs.scheduled_start);

  if (preparedAt > referenceTime) {
    results.push(createCheckResult("temporal.prepared_game", false, "error", "prepared_input", inputs.game_id, "prepared_at cannot be in the future"));
  }

  if (preparedAt.getTime() - scheduledStart.getTime() > 15 * 60 * 1000) {
    results.push(createCheckResult("temporal.prepared_game", false, "warning", "prepared_input", inputs.game_id, "prepared_at occurs materially after scheduled_start"));
  }

  if (results.length === 0) {
    results.push(createCheckResult("temporal.prepared_game", true, "info", "prepared_input", inputs.game_id, "Prepared temporal checks valid"));
  }

  return results;
};
