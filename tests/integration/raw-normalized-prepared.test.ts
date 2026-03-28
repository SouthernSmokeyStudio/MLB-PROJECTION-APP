import { describe, expect, it } from "vitest";
import rawFixture from "../../data/fixtures/sample-raw-game.json";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import { parseMlbStatsApiGamePayload } from "../../lib/adapters/mlbStatsApi";
import { normalizeMlbStatsApiGame } from "../../lib/normalization/mlbStatsApiNormalizer";
import { prepareGameInputs, type GamePreparationData } from "../../lib/preparation/prepareGameInputs";
import type {
  PreparedBatterInputs,
  PreparedPitcherInputs,
  PreparedTeamInputs
} from "../../lib/contracts/prepared";
import type { ISOTimestamp } from "../../lib/contracts/types";

const validPreparationData: GamePreparationData = {
  prepared_at: preparedFixture.prepared_at as unknown as ISOTimestamp,
  away_team: preparedFixture.away_team as unknown as PreparedTeamInputs,
  home_team: preparedFixture.home_team as unknown as PreparedTeamInputs,
  away_starter: preparedFixture.away_starter as unknown as PreparedPitcherInputs,
  home_starter: preparedFixture.home_starter as unknown as PreparedPitcherInputs,
  away_batters: preparedFixture.away_batters as unknown as readonly PreparedBatterInputs[],
  home_batters: preparedFixture.home_batters as unknown as readonly PreparedBatterInputs[]
};

describe("raw -> normalized -> prepared pipeline", () => {
  it("loads the raw fixture and parses the adapter shape", () => {
    const parsed = parseMlbStatsApiGamePayload(rawFixture);
    expect(parsed.success).toBe(true);

    if (parsed.success) {
      expect(parsed.data.gamePk).toBe(401999001);
      expect(parsed.data.teams.away.team.name).toBe("New York Yankees");
      expect(parsed.data.teams.home.team.name).toBe("Boston Red Sox");
    }
  });

  it("normalizes the parsed raw fixture into canonical game data", () => {
    const parsed = parseMlbStatsApiGamePayload(rawFixture);
    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      return;
    }

    const normalized = normalizeMlbStatsApiGame(parsed.data);
    expect(normalized.success).toBe(true);

    if (normalized.success) {
      expect(normalized.data.game_id).toBe("mlb-2026-03-27-nyy-bos");
      expect(normalized.data.away.team.abbreviation).toBe("NYY");
      expect(normalized.data.home.team.abbreviation).toBe("BOS");
    }
  });

  it("prepares valid canonical data into prepared game inputs", () => {
    const parsed = parseMlbStatsApiGamePayload(rawFixture);
    if (!parsed.success) {
      throw new Error(parsed.error);
    }

    const normalized = normalizeMlbStatsApiGame(parsed.data);
    if (!normalized.success) {
      throw new Error(normalized.error);
    }

    const prepared = prepareGameInputs(normalized.data, validPreparationData);
    expect(prepared.blocked.is_blocked).toBe(false);
    expect(prepared.has_both_starters).toBe(true);
    expect(prepared.has_both_lineups).toBe(true);
    expect(prepared.away_team.team_id).toBe(normalized.data.away.team.team_id);
    expect(prepared.home_team.team_id).toBe(normalized.data.home.team.team_id);
  });

  it("fails closed when required preparation inputs are missing", () => {
    const parsed = parseMlbStatsApiGamePayload(rawFixture);
    if (!parsed.success) {
      throw new Error(parsed.error);
    }

    const normalized = normalizeMlbStatsApiGame(parsed.data);
    if (!normalized.success) {
      throw new Error(normalized.error);
    }

    const blocked = prepareGameInputs(normalized.data, {
      prepared_at: validPreparationData.prepared_at,
      away_team: validPreparationData.away_team,
      home_team: validPreparationData.home_team,
      away_batters: validPreparationData.away_batters,
      home_batters: validPreparationData.home_batters
    });

    expect(blocked.blocked.is_blocked).toBe(true);
    expect(blocked.blocked.blocked_reason ?? "").toContain("Missing away_starter preparation data");
    expect(blocked.blocked.blocked_reason ?? "").toContain("Missing home_starter preparation data");
  });
});
