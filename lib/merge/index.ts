export { mergeGameSources } from "./mergeGameSources";
export {
  officialStarterToCandidate,
  officialLineupToCandidate,
  projectedStarterToCandidate,
  projectedLineupToCandidate,
  inferredStarterToCandidate,
  inferredLineupToCandidate,
  buildMergeGameInput,
  type PerGameSourceData
} from "./normalizeToMergeInput";
export {
  resolveGameSources,
  applyMergedStartersToCanonical
} from "./resolveGameSources";
