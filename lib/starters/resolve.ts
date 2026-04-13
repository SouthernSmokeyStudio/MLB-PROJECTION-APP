import type { GameStarterIntelligenceRow } from "./types";

/**
 * All candidate per-side starter records gathered from upstream sources
 * for a single game, before canonical resolution.
 */
export interface StarterResolutionInput {
  readonly game_id: string;
  readonly game_date: string;
  readonly away_candidates: readonly unknown[];
  readonly home_candidates: readonly unknown[];
}

/**
 * The resolved canonical per-side intelligence chosen from ranked candidates,
 * ready for write to game_starter_intelligence.
 */
export type StarterResolutionOutput = Pick<
  GameStarterIntelligenceRow,
  "away" | "home" | "resolution_notes"
>;

/**
 * Resolves the canonical starter for each side from ranked source candidates.
 * Placeholder — throws until Slice 2 resolver implementation is complete.
 */
export const resolveGameStarters = (
  _input: StarterResolutionInput
): StarterResolutionOutput => {
  throw new Error(
    "resolveGameStarters: not implemented — Slice 2 resolver required."
  );
};
