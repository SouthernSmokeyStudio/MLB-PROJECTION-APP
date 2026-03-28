import { describe, expect, it } from "vitest";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import invalidPreparedFixture from "../../data/fixtures/sample-prepared-game-invalid.json";
import type { PreparedGameInputs } from "../../lib/contracts/prepared";
import { assembleGameProjection } from "../../lib/projections/assembleGameProjection";
import { projectTeamRuns } from "../../lib/projections/projectTeamRuns";

const prepared = preparedFixture as unknown as PreparedGameInputs;
const invalidPrepared = invalidPreparedFixture as unknown as PreparedGameInputs;

describe("phase 4 projections", () => {
  it("is deterministic for identical prepared inputs", () => {
    const first = assembleGameProjection(prepared);
    const second = assembleGameProjection(prepared);

    expect(first).toStrictEqual(second);
  });

  it("returns blocked outputs with explicit blocked_reason when prepared inputs are blocked", () => {
    const blocked = assembleGameProjection(invalidPrepared);

    expect(blocked.game_projection.metadata.blocked.is_blocked).toBe(true);
    expect(blocked.game_projection.metadata.blocked.blocked_reason).toBeTruthy();
  });

  it("keeps projected total equal to away plus home", () => {
    const gameProjection = assembleGameProjection(prepared).game_projection;

    expect(gameProjection.projected_total).toBeCloseTo(
      gameProjection.away.projected_runs + gameProjection.home.projected_runs
    );
  });

  it("produces stable non-blocked team projections for the valid prepared fixture", () => {
    const teamRuns = projectTeamRuns(prepared);

    expect(teamRuns.blocked.is_blocked).toBe(false);
    expect(teamRuns.projected_away_runs).not.toBeNull();
    expect(teamRuns.projected_home_runs).not.toBeNull();
    expect(teamRuns.projected_total_runs).toBeCloseTo(
      (teamRuns.projected_away_runs ?? 0) + (teamRuns.projected_home_runs ?? 0)
    );
  });
});
