/**
 * materializer-config.test.ts
 *
 * Proves the A8 CLI config policy:
 *
 * 1. CLI constructs and passes the projected adapter when env is set
 * 2. CLI constructs and passes the inference engine
 * 3. --official-only mode produces null adapter/engine
 * 4. Missing ROTOWIRE_ENDPOINT_URL without --official-only → err
 * 5. Bad ROTOWIRE_TIMEOUT_MS → err
 * 6. No silent fallback to official-only
 */

import { describe, expect, it } from "vitest";
import {
  buildMaterializerConfig,
  type MaterializerEnv
} from "../../lib/materializer/buildMaterializerConfig";

// ---------------------------------------------------------------------------
// 1. Full config with valid env
// ---------------------------------------------------------------------------

describe("buildMaterializerConfig — full merge path", () => {
  it("constructs projected adapter with ROTOWIRE_ENDPOINT_URL", () => {
    const env: MaterializerEnv = {
      ROTOWIRE_ENDPOINT_URL: "https://api.example.com/rotowire/lineups"
    };

    const result = buildMaterializerConfig(env, { officialOnly: false });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(result.data.projectedAdapter).not.toBeNull();
    expect(result.data.projectedAdapter!.source).toBe("rotowire");
    expect(result.data.officialOnly).toBe(false);
  });

  it("constructs inference engine", () => {
    const env: MaterializerEnv = {
      ROTOWIRE_ENDPOINT_URL: "https://api.example.com/rotowire/lineups"
    };

    const result = buildMaterializerConfig(env, { officialOnly: false });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(result.data.inferenceEngine).not.toBeNull();
    expect(result.data.inferenceEngine!.engine).toBe("test-inference");
  });

  it("both adapter and engine are non-null in full merge mode", () => {
    const env: MaterializerEnv = {
      ROTOWIRE_ENDPOINT_URL: "https://api.example.com/rotowire/lineups"
    };

    const result = buildMaterializerConfig(env, { officialOnly: false });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(result.data.projectedAdapter).not.toBeNull();
    expect(result.data.inferenceEngine).not.toBeNull();
  });

  it("optional ROTOWIRE_TIMEOUT_MS is accepted when valid", () => {
    const env: MaterializerEnv = {
      ROTOWIRE_ENDPOINT_URL: "https://api.example.com/rotowire",
      ROTOWIRE_TIMEOUT_MS: "5000"
    };

    const result = buildMaterializerConfig(env, { officialOnly: false });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.projectedAdapter).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. --official-only mode
// ---------------------------------------------------------------------------

describe("buildMaterializerConfig — official-only mode", () => {
  it("--official-only produces null adapter and null engine", () => {
    const env: MaterializerEnv = {};

    const result = buildMaterializerConfig(env, { officialOnly: true });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(result.data.projectedAdapter).toBeNull();
    expect(result.data.inferenceEngine).toBeNull();
    expect(result.data.officialOnly).toBe(true);
  });

  it("--official-only ignores ROTOWIRE_ENDPOINT_URL even if set", () => {
    const env: MaterializerEnv = {
      ROTOWIRE_ENDPOINT_URL: "https://api.example.com/rotowire"
    };

    const result = buildMaterializerConfig(env, { officialOnly: true });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(result.data.projectedAdapter).toBeNull();
    expect(result.data.inferenceEngine).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Missing/bad config fails honestly
// ---------------------------------------------------------------------------

describe("buildMaterializerConfig — fail-closed on bad config", () => {
  it("missing ROTOWIRE_ENDPOINT_URL without --official-only → err", () => {
    const env: MaterializerEnv = {};

    const result = buildMaterializerConfig(env, { officialOnly: false });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("ROTOWIRE_ENDPOINT_URL");
    expect(result.error).toContain("not set");
  });

  it("empty string ROTOWIRE_ENDPOINT_URL → err", () => {
    const env: MaterializerEnv = {
      ROTOWIRE_ENDPOINT_URL: ""
    };

    const result = buildMaterializerConfig(env, { officialOnly: false });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("ROTOWIRE_ENDPOINT_URL");
  });

  it("whitespace-only ROTOWIRE_ENDPOINT_URL → err", () => {
    const env: MaterializerEnv = {
      ROTOWIRE_ENDPOINT_URL: "   "
    };

    const result = buildMaterializerConfig(env, { officialOnly: false });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("ROTOWIRE_ENDPOINT_URL");
  });

  it("non-numeric ROTOWIRE_TIMEOUT_MS → err", () => {
    const env: MaterializerEnv = {
      ROTOWIRE_ENDPOINT_URL: "https://api.example.com/rotowire",
      ROTOWIRE_TIMEOUT_MS: "not-a-number"
    };

    const result = buildMaterializerConfig(env, { officialOnly: false });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("ROTOWIRE_TIMEOUT_MS");
    expect(result.error).toContain("not a valid");
  });

  it("negative ROTOWIRE_TIMEOUT_MS → err", () => {
    const env: MaterializerEnv = {
      ROTOWIRE_ENDPOINT_URL: "https://api.example.com/rotowire",
      ROTOWIRE_TIMEOUT_MS: "-1000"
    };

    const result = buildMaterializerConfig(env, { officialOnly: false });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("ROTOWIRE_TIMEOUT_MS");
  });

  it("zero ROTOWIRE_TIMEOUT_MS → err", () => {
    const env: MaterializerEnv = {
      ROTOWIRE_ENDPOINT_URL: "https://api.example.com/rotowire",
      ROTOWIRE_TIMEOUT_MS: "0"
    };

    const result = buildMaterializerConfig(env, { officialOnly: false });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("ROTOWIRE_TIMEOUT_MS");
  });
});

// ---------------------------------------------------------------------------
// 4. No silent fallback
// ---------------------------------------------------------------------------

describe("buildMaterializerConfig — no silent fallback", () => {
  it("undefined env does NOT silently produce official-only config", () => {
    const result = buildMaterializerConfig({}, { officialOnly: false });

    // Must be err, not a silent ok with null adapters
    expect(result.success).toBe(false);
  });

  it("err message suggests --official-only as the explicit escape hatch", () => {
    const result = buildMaterializerConfig({}, { officialOnly: false });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("--official-only");
  });
});
