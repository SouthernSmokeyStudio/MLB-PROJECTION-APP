import type { CanonicalGame, CanonicalSlate } from "@lib/contracts/canonical";
import {
  DEFAULT_CHECK_CONFIG,
  summarizeChecks,
  type CheckConfig,
  type CheckSummary
} from "@lib/contracts/checks";
import type { PreparedGameInputs } from "@lib/contracts/prepared";
import { checkCanonicalGameInvariants, checkPreparedGameInvariants } from "./checkInvariants";
import { checkGameRanges } from "./checkRanges";
import { checkCanonicalGameSchema, checkCanonicalSlateSchema, checkPreparedGameSchema } from "./checkSchema";
import { checkCanonicalGameTemporal, checkPreparedGameTemporal } from "./checkTemporalConsistency";
import { checkGameCompleteness } from "./checkCompleteness";

export const runAllPreparedGameChecks = (
  inputs: PreparedGameInputs,
  config?: CheckConfig,
  referenceTime: Date = new Date()
): CheckSummary => {
  const resolvedConfig = config ?? DEFAULT_CHECK_CONFIG;

  const results = [
    ...(resolvedConfig.run_schema_checks ? checkPreparedGameSchema(inputs) : []),
    ...(resolvedConfig.run_range_checks ? checkGameRanges(inputs) : []),
    ...(resolvedConfig.run_invariant_checks ? checkPreparedGameInvariants(inputs) : []),
    ...(resolvedConfig.run_temporal_checks ? checkPreparedGameTemporal(inputs, referenceTime) : []),
    ...(resolvedConfig.run_completeness_checks ? checkGameCompleteness(inputs) : [])
  ];

  return summarizeChecks(results);
};

export const runAllCanonicalGameChecks = (
  game: CanonicalGame,
  config?: CheckConfig,
  referenceTime: Date = new Date()
): CheckSummary => {
  const resolvedConfig = config ?? DEFAULT_CHECK_CONFIG;

  const results = [
    ...(resolvedConfig.run_schema_checks ? checkCanonicalGameSchema(game) : []),
    ...(resolvedConfig.run_invariant_checks ? checkCanonicalGameInvariants(game) : []),
    ...(resolvedConfig.run_temporal_checks ? checkCanonicalGameTemporal(game, referenceTime) : [])
  ];

  return summarizeChecks(results);
};

export const runAllCanonicalSlateChecks = (
  slate: CanonicalSlate,
  config?: CheckConfig,
  referenceTime: Date = new Date()
): CheckSummary => {
  const resolvedConfig = config ?? DEFAULT_CHECK_CONFIG;
  const base = resolvedConfig.run_schema_checks ? checkCanonicalSlateSchema(slate) : [];
  const gameResults = slate.games.flatMap((game) =>
    runAllCanonicalGameChecks(game, resolvedConfig, referenceTime).results
  );

  return summarizeChecks([...base, ...gameResults]);
};

export const shouldBlockGame = (
  inputs: PreparedGameInputs,
  summary: CheckSummary,
  config?: CheckConfig
): { blocked: boolean; reason: string | null } => {
  const resolvedConfig = config ?? DEFAULT_CHECK_CONFIG;

  if (inputs.blocked.is_blocked) {
    return { blocked: true, reason: inputs.blocked.blocked_reason };
  }

  if (summary.errors > 0) {
    const reasons = summary.results
      .filter((result) => !result.passed && result.severity === "error")
      .slice(0, 3)
      .map((result) => result.message);

    return { blocked: true, reason: reasons.join("; ") };
  }

  if (resolvedConfig.fail_on_warnings && summary.warnings > 0) {
    return { blocked: true, reason: "Warnings escalated to blocking by configuration" };
  }

  return { blocked: false, reason: null };
};
