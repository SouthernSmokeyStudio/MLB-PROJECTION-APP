import { describe, expect, it } from "vitest";
import { DK_CLASSIC_RULES_V1, ipToOuts, outsToIp } from "@lib/contracts/scoring";
import { SPORT_ID, asGameId, ok, err } from "@lib/contracts/types";

describe("contracts", () => {
  it("brands ids through helper functions", () => {
    expect(asGameId("game-1")).toBe("game-1");
  });

  it("uses MLB as the locked sport id", () => {
    expect(SPORT_ID).toBe("MLB");
  });

  it("creates success results", () => {
    const result = ok({ value: 1 });
    expect(result.success).toBe(true);
  });

  it("creates error results", () => {
    const result = err("broken");
    expect(result.success).toBe(false);
  });

  it("keeps draftkings scoring locked", () => {
    expect(DK_CLASSIC_RULES_V1.platform).toBe("draftkings");
    expect(DK_CLASSIC_RULES_V1.batter.home_run).toBe(10);
    expect(DK_CLASSIC_RULES_V1.pitcher.inning_pitched).toBe(2.25);
  });

  it("converts innings pitched to outs and back", () => {
    expect(ipToOuts(6.1)).toBe(19);
    expect(outsToIp(19)).toBe(6.1);
  });
});
