import { createCheckResult, type CheckResult } from "@lib/contracts/checks";
import type { CanonicalGame } from "@lib/contracts/canonical";
import type { PreparedGameInputs } from "@lib/contracts/prepared";

export const checkCanonicalGameInvariants = (game: CanonicalGame): readonly CheckResult[] => {
  const results: CheckResult[] = [];

  if (game.away.team.team_id === game.home.team.team_id) {
    results.push(createCheckResult("invariant.canonical_game", false, "error", "game", game.game_id, "away and home teams cannot match"));
  }

  if (results.length === 0) {
    results.push(createCheckResult("invariant.canonical_game", true, "info", "game", game.game_id, "Canonical invariants valid"));
  }

  return results;
};

export const checkPreparedGameInvariants = (inputs: PreparedGameInputs): readonly CheckResult[] => {
  const results: CheckResult[] = [];

  const awayIds = inputs.away_batters.map((b) => b.player_id);
  const homeIds = inputs.home_batters.map((b) => b.player_id);

  if (new Set(awayIds).size !== awayIds.length) {
    results.push(createCheckResult("invariant.prepared_game", false, "error", "prepared_input", inputs.game_id, "duplicate away batter ids"));
  }

  if (new Set(homeIds).size !== homeIds.length) {
    results.push(createCheckResult("invariant.prepared_game", false, "error", "prepared_input", inputs.game_id, "duplicate home batter ids"));
  }

  if (inputs.has_both_starters !== (inputs.away_starter !== null && inputs.home_starter !== null)) {
    results.push(createCheckResult("invariant.prepared_game", false, "error", "prepared_input", inputs.game_id, "has_both_starters flag mismatch"));
  }

  if (inputs.has_both_lineups !== (inputs.away_batters.length > 0 && inputs.home_batters.length > 0)) {
    results.push(createCheckResult("invariant.prepared_game", false, "error", "prepared_input", inputs.game_id, "has_both_lineups flag mismatch"));
  }

  if (inputs.completeness_score < 0 || inputs.completeness_score > 1) {
    results.push(createCheckResult("invariant.prepared_game", false, "error", "prepared_input", inputs.game_id, "completeness_score must be between 0 and 1"));
  }

  if (results.length === 0) {
    results.push(createCheckResult("invariant.prepared_game", true, "info", "prepared_input", inputs.game_id, "Prepared invariants valid"));
  }

  return results;
};
