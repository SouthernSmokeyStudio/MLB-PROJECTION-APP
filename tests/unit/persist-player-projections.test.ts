import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PreparedBatterInputs,
  PreparedGameInputs,
  PreparedPitcherInputs,
  PreparedTeamInputs
} from "../../lib/contracts/prepared";
import { asGameId, asISOTimestamp, asPlayerId, asTeamId } from "../../lib/contracts/types";
import { assembleGameProjection } from "../../lib/projections/assembleGameProjection";
import {
  persistPlayerProjections,
  type AtomicProjectionRunPayload
} from "../../lib/services/persistPlayerProjections";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

const makeTeam = (id: string): PreparedTeamInputs => ({
  team_id: asTeamId(id),
  team_woba: 0.32,
  team_runs_per_game: 4.6,
  team_k_rate: 0.22,
  team_bb_rate: 0.085,
  team_era: 4.0,
  team_whip: 1.25,
  bullpen_era: 4.1,
  lineup_batters_available: 9,
  lineup_avg_woba: null
});

const makePitcher = (
  id: string,
  teamId: string,
  handedness: "L" | "R" = "R"
): PreparedPitcherInputs => ({
  player_id: asPlayerId(id),
  mlb_stats_api_id: id,
  team_id: asTeamId(teamId),
  handedness,
  season_ip: 150,
  season_era: 3.5,
  season_whip: 1.15,
  season_k_per_9: 9.0,
  season_bb_per_9: 3.0,
  season_hr_per_9: 1.0,
  recent_starts_n: 5,
  recent_era: 3.2,
  recent_k_per_9: 9.5,
  recent_ip_per_start: 6.0,
  vs_lhb_era: null,
  vs_rhb_era: null,
  days_rest: 5,
  last_start_pitches: 95
});

const makeBatter = (
  id: string,
  teamId: string,
  slot: number,
  overrides: Partial<PreparedBatterInputs> = {}
): PreparedBatterInputs => ({
  player_id: asPlayerId(id),
  mlb_stats_api_id: null,
  team_id: asTeamId(teamId),
  batting_order: slot,
  lineup_status: "confirmed_order",
  handedness: "R",
  season_pa: 500,
  season_avg: 0.27,
  season_obp: 0.34,
  season_slg: 0.45,
  season_woba: 0.34,
  season_iso: 0.18,
  season_k_rate: 0.2,
  season_bb_rate: 0.09,
  season_hr_rate: 0.04,
  season_sb: 10,
  recent_games_n: null,
  recent_woba: null,
  recent_avg: null,
  vs_lhp_woba: null,
  vs_rhp_woba: null,
  ...overrides
});

const makeFullLineup = (
  teamId: string,
  overrides: Partial<PreparedBatterInputs> = {}
): PreparedBatterInputs[] =>
  Array.from({ length: 9 }, (_, i) =>
    makeBatter(`${teamId}-b${i + 1}`, teamId, i + 1, overrides)
  );

const makeGame = (overrides: Partial<PreparedGameInputs> = {}): PreparedGameInputs => ({
  game_id: asGameId("persist-test-game"),
  sport_id: "MLB",
  scheduled_start: asISOTimestamp("2026-04-01T19:00:00Z"),
  prepared_at: asISOTimestamp("2026-04-01T15:00:00Z"),
  venue: { park_factor_runs: 1.0, is_dome: false, is_retractable_roof: false },
  weather: {
    temperature_f: 72,
    wind_speed_mph: 5,
    wind_direction_normalized: "out",
    is_enclosed: false
  },
  away_team: makeTeam("team-a"),
  home_team: makeTeam("team-h"),
  away_starter: makePitcher("pitcher-a", "team-a", "R"),
  home_starter: makePitcher("pitcher-h", "team-h", "L"),
  away_batters: makeFullLineup("team-a"),
  home_batters: makeFullLineup("team-h"),
  blocked: { is_blocked: false, blocked_reason: null },
  team_level_ready: true,
  has_both_starters: true,
  has_both_lineups: true,
  completeness_score: 1.0,
  ...overrides
});

// ---------------------------------------------------------------------------
// Mock Supabase client
// ---------------------------------------------------------------------------

interface MockRpcCall {
  readonly name: string;
  readonly payload: unknown;
}

const makeMockClient = (options?: { fail?: boolean }) => {
  const rpcCalls: MockRpcCall[] = [];

  const client = {
    rpc: async (name: string, payload: unknown) => {
      rpcCalls.push({ name, payload });
      if (options?.fail) {
        return { data: null, error: { message: "mock RPC failure: persist_projection_run" } };
      }
      return { data: null, error: null };
    }
  } as unknown as SupabaseClient;

  return { client, rpcCalls };
};

// ---------------------------------------------------------------------------
// Shared base args
// ---------------------------------------------------------------------------

const BASE = {
  projectedAt: "2026-04-01T15:00:00Z",
  playerProjectionFormulaVersion: "phase4-baseline-v1",
  parameterSetVersion: "v1",
  preparedInputLineageRef: "prepared-game-inputs:2026-04-01",
  teamRunLineageRef: "team-runs:2026-04-01"
};

// ---------------------------------------------------------------------------
// Atomic write boundary
// ---------------------------------------------------------------------------

describe("persistPlayerProjections — atomic write boundary", () => {
  it("makes exactly one RPC call with the correct function name and full payload shape", async () => {
    const { client, rpcCalls } = makeMockClient();
    const preparedGame = makeGame();
    const assembledProjection = assembleGameProjection(preparedGame);

    const result = await persistPlayerProjections({
      ...BASE,
      sourceGames: [{ preparedGame, assembledProjection }],
      client
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]?.name).toBe("persist_projection_run");

    const payload = rpcCalls[0]?.payload as AtomicProjectionRunPayload;

    expect(payload.run).toMatchObject({
      projected_at: BASE.projectedAt,
      parameter_set_version: "v1",
      prepared_input_lineage_ref: BASE.preparedInputLineageRef,
      team_run_lineage_ref: BASE.teamRunLineageRef
    });

    expect(Array.isArray(payload.batters)).toBe(true);
    expect(payload.batters.length).toBeGreaterThan(0);

    expect(Array.isArray(payload.pitchers)).toBe(true);
    expect(payload.pitchers.length).toBe(2);

    expect(result.persistedBatterRowCount).toBeGreaterThan(0);
    expect(result.persistedPitcherRowCount).toBe(2);
    expect(result.persistedGameCount).toBe(1);
  });

  it("returns ok false when the atomic RPC boundary fails and does not report success", async () => {
    const { client, rpcCalls } = makeMockClient({ fail: true });
    const preparedGame = makeGame();
    const assembledProjection = assembleGameProjection(preparedGame);

    const result = await persistPlayerProjections({
      ...BASE,
      sourceGames: [{ preparedGame, assembledProjection }],
      client
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");

    expect(result.error.message).toMatch(/persist_projection_run/);
    expect(rpcCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Skipped players
// ---------------------------------------------------------------------------

describe("persistPlayerProjections — skipped players absent from persisted rows", () => {
  it("a batter dropped during projection does not appear in the RPC payload batters", async () => {
    const { client, rpcCalls } = makeMockClient();
    const awayBatters = makeFullLineup("team-a");
    // Null season_avg causes projectBatters to skip this batter entirely.
    awayBatters[4] = { ...awayBatters[4]!, season_avg: null };

    const preparedGame = makeGame({ away_batters: awayBatters });
    const assembledProjection = assembleGameProjection(preparedGame);

    expect(assembledProjection.away_batters).toHaveLength(8);

    const result = await persistPlayerProjections({
      ...BASE,
      sourceGames: [{ preparedGame, assembledProjection }],
      client
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;

    const payload = rpcCalls[0]?.payload as AtomicProjectionRunPayload;
    const awayRows = payload.batters.filter((r) => r.player_id.startsWith("team-a-b"));
    expect(awayRows).toHaveLength(8);
    expect(awayRows.find((r) => r.player_id === "team-a-b5")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// lineup_path
// ---------------------------------------------------------------------------

describe("persistPlayerProjections — lineup_path derivation", () => {
  it("confirmed_order batters produce lineup_path confirmed_order in the RPC payload", async () => {
    const { client, rpcCalls } = makeMockClient();
    const preparedGame = makeGame();
    const assembledProjection = assembleGameProjection(preparedGame);

    const result = await persistPlayerProjections({
      ...BASE,
      sourceGames: [{ preparedGame, assembledProjection }],
      client
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;

    const payload = rpcCalls[0]?.payload as AtomicProjectionRunPayload;
    expect(payload.batters.length).toBeGreaterThan(0);
    expect(payload.batters.every((r) => r.lineup_path === "confirmed_order")).toBe(true);
  });

  it("season_stats_fallback batters produce lineup_path season_stats_fallback in the RPC payload", async () => {
    const { client, rpcCalls } = makeMockClient();
    const awayBatters = makeFullLineup("team-a", {
      lineup_status: "season_stats_fallback",
      batting_order: null
    });

    const preparedGame = makeGame({ away_batters: awayBatters });
    const assembledProjection = assembleGameProjection(preparedGame);

    const result = await persistPlayerProjections({
      ...BASE,
      sourceGames: [{ preparedGame, assembledProjection }],
      client
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;

    const payload = rpcCalls[0]?.payload as AtomicProjectionRunPayload;
    const awayRows = payload.batters.filter((r) => r.player_id.startsWith("team-a-b"));
    expect(awayRows.length).toBeGreaterThan(0);
    expect(awayRows.every((r) => r.lineup_path === "season_stats_fallback")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fallback booleans
// ---------------------------------------------------------------------------

describe("persistPlayerProjections — fallback booleans", () => {
  it("confirmed_order batters have all four fallback booleans false in the RPC payload", async () => {
    const { client, rpcCalls } = makeMockClient();
    const preparedGame = makeGame();
    const assembledProjection = assembleGameProjection(preparedGame);

    const result = await persistPlayerProjections({
      ...BASE,
      sourceGames: [{ preparedGame, assembledProjection }],
      client
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;

    const payload = rpcCalls[0]?.payload as AtomicProjectionRunPayload;
    expect(payload.batters.length).toBeGreaterThan(0);
    for (const row of payload.batters) {
      expect(row.used_fallback_season_bb_rate).toBe(false);
      expect(row.used_fallback_season_hr_rate).toBe(false);
      expect(row.used_fallback_season_sb).toBe(false);
      expect(row.used_fallback_season_woba).toBe(false);
    }
  });

  it("season_stats_fallback batters with null stat fields produce true fallback booleans in the RPC payload", async () => {
    const { client, rpcCalls } = makeMockClient();
    // Away batters are fallback with null optional stat fields.
    // home_starter is L-handed (makeGame default), so used_fallback_season_woba
    // for away batters = isFallback && vs_lhp_woba === null.
    const awayBatters = makeFullLineup("team-a", {
      lineup_status: "season_stats_fallback",
      batting_order: null,
      season_bb_rate: null,
      season_hr_rate: null,
      season_sb: null,
      vs_lhp_woba: null
    });

    const preparedGame = makeGame({ away_batters: awayBatters });
    const assembledProjection = assembleGameProjection(preparedGame);

    const result = await persistPlayerProjections({
      ...BASE,
      sourceGames: [{ preparedGame, assembledProjection }],
      client
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;

    const payload = rpcCalls[0]?.payload as AtomicProjectionRunPayload;
    const awayRows = payload.batters.filter((r) => r.player_id.startsWith("team-a-b"));
    expect(awayRows.length).toBeGreaterThan(0);

    for (const row of awayRows) {
      expect(row.used_fallback_season_bb_rate).toBe(true);
      expect(row.used_fallback_season_hr_rate).toBe(true);
      expect(row.used_fallback_season_sb).toBe(true);
      expect(row.used_fallback_season_woba).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Failure handling
// ---------------------------------------------------------------------------

describe("persistPlayerProjections — failure handling", () => {
  it("returns ok false and makes no additional calls when sourceGames is empty", async () => {
    const { client, rpcCalls } = makeMockClient();

    const result = await persistPlayerProjections({
      ...BASE,
      sourceGames: [],
      client
    });

    expect(result.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Blocked / zero-batter-row games
// ---------------------------------------------------------------------------

describe("persistPlayerProjections — blocked / zero-batter-row games", () => {
  it("does not fail when a game has no projected batter rows and opponent starter context is missing", async () => {
    const { client, rpcCalls } = makeMockClient();

    // Game has no lineups and no starters — the assembled projection will
    // produce zero batter rows. Opponent starter context is absent (null).
    // The service must not throw; row-level derivation never runs.
    const preparedGame = makeGame({
      away_batters: [],
      home_batters: [],
      away_starter: null,
      home_starter: null
    });
    const assembledProjection = assembleGameProjection(preparedGame);

    expect(assembledProjection.away_batters).toHaveLength(0);
    expect(assembledProjection.home_batters).toHaveLength(0);

    const result = await persistPlayerProjections({
      ...BASE,
      sourceGames: [{ preparedGame, assembledProjection }],
      client
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;

    expect(rpcCalls).toHaveLength(1);
    const payload = rpcCalls[0]?.payload as AtomicProjectionRunPayload;
    expect(payload.batters).toHaveLength(0);
    expect(result.persistedBatterRowCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Rerun / append-only behavior
// ---------------------------------------------------------------------------

describe("persistPlayerProjections — rerun / append-only behavior", () => {
  it("two sequential calls without a supplied run_id produce distinct run_id values in the RPC payload", async () => {
    const preparedGame = makeGame();
    const assembledProjection = assembleGameProjection(preparedGame);

    const { client: client1, rpcCalls: calls1 } = makeMockClient();
    const { client: client2, rpcCalls: calls2 } = makeMockClient();

    const result1 = await persistPlayerProjections({
      ...BASE,
      sourceGames: [{ preparedGame, assembledProjection }],
      client: client1
    });

    const result2 = await persistPlayerProjections({
      ...BASE,
      sourceGames: [{ preparedGame, assembledProjection }],
      client: client2
    });

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (!result1.ok || !result2.ok) throw new Error("Expected both to succeed");

    expect(result1.runId).not.toBe(result2.runId);

    const payload1 = calls1[0]?.payload as AtomicProjectionRunPayload;
    const payload2 = calls2[0]?.payload as AtomicProjectionRunPayload;
    expect(payload1.run.run_id).not.toBe(payload2.run.run_id);
  });

  it("caller-supplied run_id is used as-is in both the return value and the RPC payload", async () => {
    const { client, rpcCalls } = makeMockClient();
    const preparedGame = makeGame();
    const assembledProjection = assembleGameProjection(preparedGame);

    const result = await persistPlayerProjections({
      ...BASE,
      sourceGames: [{ preparedGame, assembledProjection }],
      runId: "fixed-run-id-for-test",
      client
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;

    expect(result.runId).toBe("fixed-run-id-for-test");

    const payload = rpcCalls[0]?.payload as AtomicProjectionRunPayload;
    expect(payload.run.run_id).toBe("fixed-run-id-for-test");
  });
});
