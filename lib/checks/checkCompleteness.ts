import { createCheckResult, type CheckResult } from "@lib/contracts/checks";
import type { PreparedBatterInputs, PreparedGameInputs, PreparedPitcherInputs } from "@lib/contracts/prepared";
import { SAMPLE_SIZE_THRESHOLDS } from "@lib/config/constants";

export const checkBatterCompleteness = (batter: PreparedBatterInputs): readonly CheckResult[] => {
  const results: CheckResult[] = [];
  if (batter.season_pa === null || batter.season_pa < SAMPLE_SIZE_THRESHOLDS.batter_season_pa_min) {
    results.push(createCheckResult("completeness.batter", false, "warning", "batter", batter.player_id, "season_pa below threshold"));
  }
  if (results.length === 0) {
    results.push(createCheckResult("completeness.batter", true, "info", "batter", batter.player_id, "Batter completeness valid"));
  }
  return results;
};

export const checkPitcherCompleteness = (pitcher: PreparedPitcherInputs): readonly CheckResult[] => {
  const results: CheckResult[] = [];
  if (pitcher.season_ip === null || pitcher.season_ip < SAMPLE_SIZE_THRESHOLDS.pitcher_season_ip_min) {
    results.push(createCheckResult("completeness.pitcher", false, "warning", "pitcher", pitcher.player_id, "season_ip below threshold"));
  }
  if (results.length === 0) {
    results.push(createCheckResult("completeness.pitcher", true, "info", "pitcher", pitcher.player_id, "Pitcher completeness valid"));
  }
  return results;
};

export const checkGameCompleteness = (inputs: PreparedGameInputs): readonly CheckResult[] => {
  const results: CheckResult[] = [];

  if (!inputs.has_both_starters) {
    results.push(createCheckResult("completeness.game", false, "warning", "prepared_input", inputs.game_id, "missing starting pitcher data"));
  }

  if (!inputs.has_both_lineups) {
    results.push(createCheckResult("completeness.game", false, "warning", "prepared_input", inputs.game_id, "missing lineup data"));
  }

  if (inputs.blocked.is_blocked && !inputs.blocked.blocked_reason) {
    results.push(createCheckResult("completeness.game", false, "error", "prepared_input", inputs.game_id, "blocked inputs require blocked_reason"));
  }

  for (const batter of [...inputs.away_batters, ...inputs.home_batters]) {
    results.push(...checkBatterCompleteness(batter));
  }

  if (inputs.away_starter) results.push(...checkPitcherCompleteness(inputs.away_starter));
  if (inputs.home_starter) results.push(...checkPitcherCompleteness(inputs.home_starter));

  if (results.length === 0) {
    results.push(createCheckResult("completeness.game", true, "info", "prepared_input", inputs.game_id, "Game completeness valid"));
  }

  return results;
};
