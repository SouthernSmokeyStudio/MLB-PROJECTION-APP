import type { VersionInfo } from "@lib/contracts/types";

export const CURRENT_VERSION: VersionInfo = {
  model_version: "0.1.0",
  feature_set_version: "0.1.0",
  scoring_version: "dk_classic_v1",
  data_version: "0.1.0"
};

export const RANGE_BOUNDS = {
  batting_avg: { min: 0, max: 0.5 },
  on_base_pct: { min: 0, max: 0.7 },
  slugging_pct: { min: 0, max: 1.2 },
  woba: { min: 0, max: 0.6 },
  k_rate: { min: 0, max: 0.6 },
  bb_rate: { min: 0, max: 0.4 },
  era: { min: 0, max: 20 },
  whip: { min: 0, max: 4 },
  k_per_9: { min: 0, max: 20 },
  bb_per_9: { min: 0, max: 15 },
  hr_per_9: { min: 0, max: 5 },
  innings_pitched: { min: 0, max: 9 },
  park_factor: { min: 0.7, max: 1.4 },
  temperature_f: { min: 20, max: 120 },
  wind_speed_mph: { min: 0, max: 50 }
} as const;

export const SAMPLE_SIZE_THRESHOLDS = {
  batter_season_pa_min: 50,
  pitcher_season_ip_min: 20
} as const;
