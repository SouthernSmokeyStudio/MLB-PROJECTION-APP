import type { StarterFreshnessStatus, StarterSideIntelligence, StarterSourceTier, StarterStatus } from "./types";

/**
 * Raw upstream starter record before normalization.
 * Adapters map their native format into this shape — source-agnostic.
 */
export interface RawStarterInput {
  readonly player_id: string | null;
  readonly mlb_stats_api_id: string | null;
  readonly full_name: string | null;
  readonly source_key: string;
  readonly source_tier: StarterSourceTier;
  readonly status: StarterStatus;
  readonly observed_at: string;
  readonly source_updated_at: string | null;
  readonly raw_ref: Record<string, unknown> | null;
}

/**
 * Normalized per-side input with confidence and freshness scored,
 * ready for the resolver and DB write.
 * Placeholder type boundary — calculation logic lives in a future ingest slice.
 */
export interface NormalizedStarterInput {
  readonly side: "away" | "home";
  readonly input: RawStarterInput;
  readonly confidence: number;
  readonly freshness_status: StarterFreshnessStatus;
}

/**
 * Normalizes a raw starter input into a per-side intelligence shape.
 * Placeholder — throws until Slice 2 ingest is implemented.
 */
export const normalizeStarterInput = (
  _input: RawStarterInput
): StarterSideIntelligence => {
  throw new Error(
    "normalizeStarterInput: not implemented — Slice 2 ingest required."
  );
};
