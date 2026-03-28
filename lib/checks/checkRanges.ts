import { createCheckResult, type CheckResult } from "@lib/contracts/checks";
import type { PreparedBatterInputs, PreparedGameInputs, PreparedPitcherInputs } from "@lib/contracts/prepared";
import { RANGE_BOUNDS } from "@lib/config/constants";

const outOfRange = (
  value: number | null,
  min: number,
  max: number,
  name: string,
  entityType: "batter" | "pitcher" | "game",
  entityId: string | null
): CheckResult | null => {
  if (value === null) return null;
  if (value < min || value > max) {
    return createCheckResult(`range.${entityType}`, false, "error", entityType, entityId, `${name} outside allowed range`, {
      value,
      min,
      max
    });
  }
  return null;
};

export const checkBatterRanges = (batter: PreparedBatterInputs): readonly CheckResult[] => {
  const results: CheckResult[] = [];
  const checks = [
    outOfRange(batter.season_avg, RANGE_BOUNDS.batting_avg.min, RANGE_BOUNDS.batting_avg.max, "season_avg", "batter", batter.player_id),
    outOfRange(batter.season_obp, RANGE_BOUNDS.on_base_pct.min, RANGE_BOUNDS.on_base_pct.max, "season_obp", "batter", batter.player_id),
    outOfRange(batter.season_slg, RANGE_BOUNDS.slugging_pct.min, RANGE_BOUNDS.slugging_pct.max, "season_slg", "batter", batter.player_id)
  ].filter(Boolean) as CheckResult[];

  results.push(...checks);
  if (results.length === 0) {
    results.push(createCheckResult("range.batter", true, "info", "batter", batter.player_id, "Batter ranges valid"));
  }
  return results;
};

export const checkPitcherRanges = (pitcher: PreparedPitcherInputs): readonly CheckResult[] => {
  const results: CheckResult[] = [];
  const checks = [
    outOfRange(pitcher.season_era, RANGE_BOUNDS.era.min, RANGE_BOUNDS.era.max, "season_era", "pitcher", pitcher.player_id),
    outOfRange(pitcher.season_whip, RANGE_BOUNDS.whip.min, RANGE_BOUNDS.whip.max, "season_whip", "pitcher", pitcher.player_id),
    outOfRange(pitcher.recent_ip_per_start, RANGE_BOUNDS.innings_pitched.min, RANGE_BOUNDS.innings_pitched.max, "recent_ip_per_start", "pitcher", pitcher.player_id)
  ].filter(Boolean) as CheckResult[];

  results.push(...checks);
  if (results.length === 0) {
    results.push(createCheckResult("range.pitcher", true, "info", "pitcher", pitcher.player_id, "Pitcher ranges valid"));
  }
  return results;
};

export const checkGameRanges = (inputs: PreparedGameInputs): readonly CheckResult[] => {
  const results: CheckResult[] = [];

  const venueResult = outOfRange(
    inputs.venue?.park_factor_runs ?? null,
    RANGE_BOUNDS.park_factor.min,
    RANGE_BOUNDS.park_factor.max,
    "park_factor_runs",
    "game",
    inputs.game_id
  );
  if (venueResult) results.push(venueResult);

  const tempResult = outOfRange(
    inputs.weather?.temperature_f ?? null,
    RANGE_BOUNDS.temperature_f.min,
    RANGE_BOUNDS.temperature_f.max,
    "temperature_f",
    "game",
    inputs.game_id
  );
  if (tempResult) results.push(tempResult);

  const windResult = outOfRange(
    inputs.weather?.wind_speed_mph ?? null,
    RANGE_BOUNDS.wind_speed_mph.min,
    RANGE_BOUNDS.wind_speed_mph.max,
    "wind_speed_mph",
    "game",
    inputs.game_id
  );
  if (windResult) results.push(windResult);

  for (const batter of [...inputs.away_batters, ...inputs.home_batters]) {
    results.push(...checkBatterRanges(batter));
  }

  if (inputs.away_starter) results.push(...checkPitcherRanges(inputs.away_starter));
  if (inputs.home_starter) results.push(...checkPitcherRanges(inputs.home_starter));

  if (results.length === 0) {
    results.push(createCheckResult("range.game", true, "info", "game", inputs.game_id, "Game ranges valid"));
  }

  return results;
};
