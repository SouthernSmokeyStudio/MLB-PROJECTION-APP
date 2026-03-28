import type { MlbStatsApiScheduleGame } from "@lib/adapters/contracts";
import type { CanonicalGame } from "@lib/contracts/canonical";
import { nowISO, type ISOTimestamp, type Result } from "@lib/contracts/types";

export interface NormalizationContext {
  readonly fetched_at: ISOTimestamp;
  readonly endpoint: string;
  readonly raw_payload_hash: string | null;
  readonly raw_payload_ref: string;
}

export interface MlbStatsApiGameNormalizer {
  normalizeGame(
    raw: MlbStatsApiScheduleGame,
    context?: Partial<NormalizationContext>
  ): Result<CanonicalGame, string>;
}

export const createDefaultNormalizationContext = (raw_payload_ref: string): NormalizationContext => ({
  fetched_at: nowISO(),
  endpoint: "/v1/schedule",
  raw_payload_hash: null,
  raw_payload_ref
});
