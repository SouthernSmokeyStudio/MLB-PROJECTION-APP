/**
 * buildMaterializerConfig.ts
 *
 * Constructs the projected adapter and inference engine from environment
 * configuration, producing a typed config object for materializeSlate.
 *
 * Env vars:
 *   ROTOWIRE_ENDPOINT_URL — full URL for the Rotowire projected lineups feed.
 *                            Required when --official-only is NOT set.
 *   ROTOWIRE_TIMEOUT_MS   — optional fetch timeout override (default: 15s).
 *
 * CLI flags:
 *   --official-only — skip projected + inferred tiers entirely.
 *                     Only valid when the caller explicitly intends to
 *                     run without merge.  This is the ONLY way to get
 *                     an official-only artifact — missing config is NOT
 *                     silently downgraded to official-only.
 *
 * Fail-closed:
 *   - Missing ROTOWIRE_ENDPOINT_URL without --official-only → err
 *   - No silent fallback to official-only
 */

import type { ProjectedSourceAdapter } from "@lib/contracts/projected-source";
import type { InferenceEngine } from "@lib/contracts/inferred-source";
import { err, ok, type Result } from "@lib/contracts/types";
import { createRotowireProjectedSourceAdapter } from "@lib/adapters/rotowireProjectedSource";
import { createTestInferenceEngine } from "@lib/inference/testInferenceEngine";

// ---------------------------------------------------------------------------
// Config result
// ---------------------------------------------------------------------------

export interface MaterializerConfig {
  /** Projected source adapter (null when --official-only). */
  readonly projectedAdapter: ProjectedSourceAdapter | null;
  /** Inference engine (null when --official-only). */
  readonly inferenceEngine: InferenceEngine | null;
  /** Whether the caller explicitly opted into official-only mode. */
  readonly officialOnly: boolean;
}

// ---------------------------------------------------------------------------
// Environment reading (pure — takes env as argument for testability)
// ---------------------------------------------------------------------------

export interface MaterializerEnv {
  readonly ROTOWIRE_ENDPOINT_URL?: string | undefined;
  readonly ROTOWIRE_TIMEOUT_MS?: string | undefined;
}

/**
 * Build materializer config from environment and CLI flags.
 *
 * This is the single point where provider instantiation decisions are made.
 * Every other module receives pre-built adapters/engines — no env reads
 * leak past this boundary.
 */
export const buildMaterializerConfig = (
  env: MaterializerEnv,
  flags: { readonly officialOnly: boolean }
): Result<MaterializerConfig, string> => {
  // --official-only: skip all non-official tiers
  if (flags.officialOnly) {
    return ok({
      projectedAdapter: null,
      inferenceEngine: null,
      officialOnly: true
    });
  }

  // ---------- Projected adapter ----------
  const rotowireUrl = env.ROTOWIRE_ENDPOINT_URL?.trim();
  if (!rotowireUrl || rotowireUrl.length === 0) {
    return err(
      "ROTOWIRE_ENDPOINT_URL is not set. " +
      "Set the env var to enable projected lineups, or pass --official-only to skip."
    );
  }

  const timeoutMs = env.ROTOWIRE_TIMEOUT_MS
    ? parseInt(env.ROTOWIRE_TIMEOUT_MS, 10)
    : undefined;

  if (env.ROTOWIRE_TIMEOUT_MS && (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    return err(`ROTOWIRE_TIMEOUT_MS is not a valid positive number: "${env.ROTOWIRE_TIMEOUT_MS}"`);
  }

  const projectedAdapter = createRotowireProjectedSourceAdapter({
    endpointUrl: rotowireUrl,
    ...(timeoutMs ? { timeoutMs } : {})
  });

  // ---------- Inference engine ----------
  // A8 uses the test inference engine boundary.  Future sub-slices will
  // replace this with a real heuristic engine.  The test engine returns
  // empty games (no inferred data) unless pre-loaded — which means the
  // merge law sees inferred tier as absent, and projected/official win.
  const inferenceEngine = createTestInferenceEngine();

  return ok({
    projectedAdapter,
    inferenceEngine,
    officialOnly: false
  });
};
