import type { CheckSeverity, EntityType, ISOTimestamp } from "./types";
import { nowISO } from "./types";

export interface CheckResult {
  readonly check_name: string;
  readonly passed: boolean;
  readonly severity: CheckSeverity;
  readonly entity_type: EntityType;
  readonly entity_id: string | null;
  readonly message: string;
  readonly details: Record<string, unknown> | null;
  readonly timestamp: ISOTimestamp;
}

export interface CheckSummary {
  readonly total_checks: number;
  readonly passed: number;
  readonly failed: number;
  readonly errors: number;
  readonly warnings: number;
  readonly infos: number;
  readonly all_passed: boolean;
  readonly blocking_failures: boolean;
  readonly results: readonly CheckResult[];
}

export interface CheckConfig {
  readonly run_schema_checks: boolean;
  readonly run_range_checks: boolean;
  readonly run_invariant_checks: boolean;
  readonly run_temporal_checks: boolean;
  readonly run_completeness_checks: boolean;
  readonly fail_on_warnings: boolean;
}

export const DEFAULT_CHECK_CONFIG: CheckConfig = {
  run_schema_checks: true,
  run_range_checks: true,
  run_invariant_checks: true,
  run_temporal_checks: true,
  run_completeness_checks: true,
  fail_on_warnings: false
};

export const createCheckResult = (
  check_name: string,
  passed: boolean,
  severity: CheckSeverity,
  entity_type: EntityType,
  entity_id: string | null,
  message: string,
  details: Record<string, unknown> | null = null
): CheckResult => ({
  check_name,
  passed,
  severity,
  entity_type,
  entity_id,
  message,
  details,
  timestamp: nowISO()
});

export const summarizeChecks = (results: readonly CheckResult[]): CheckSummary => {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  const errors = results.filter((r) => !r.passed && r.severity === "error").length;
  const warnings = results.filter((r) => !r.passed && r.severity === "warning").length;
  const infos = results.filter((r) => !r.passed && r.severity === "info").length;

  return {
    total_checks: results.length,
    passed,
    failed,
    errors,
    warnings,
    infos,
    all_passed: failed === 0,
    blocking_failures: errors > 0,
    results
  };
};
