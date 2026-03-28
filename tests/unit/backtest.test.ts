import { describe, expect, it } from "vitest";
import {
  computeBias,
  computeMae,
  summarizeErrorMetrics
} from "../../lib/backtest/metrics";

describe("phase 6 backtest metrics", () => {
  it("computes deterministic MAE and bias", () => {
    const rows = [
      { projected: 4, actual: 5 },
      { projected: 6, actual: 4 },
      { projected: null, actual: 3, skipped: true }
    ] as const;

    expect(computeMae(rows)).toBeCloseTo(1.5);
    expect(computeBias(rows)).toBeCloseTo(0.5);
  });

  it("reports evaluated and skipped counts honestly", () => {
    const rows = [
      { projected: 4, actual: 5 },
      { projected: 6, actual: 4 },
      { projected: null, actual: 3, skipped: true }
    ] as const;

    const summary = summarizeErrorMetrics(rows);

    expect(summary.evaluated_count).toBe(2);
    expect(summary.skipped_count).toBe(1);
    expect(summary.mae).toBeCloseTo(1.5);
    expect(summary.bias).toBeCloseTo(0.5);
  });
});
