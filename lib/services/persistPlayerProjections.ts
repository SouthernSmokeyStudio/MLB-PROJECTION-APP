import type { SupabaseClient } from "@supabase/supabase-js";
import type { PreparedBatterInputs, PreparedGameInputs } from "@lib/contracts/prepared";
import type { AssembledGameProjection } from "@lib/projections/assembleGameProjection";
import type { BatterProjection, PitcherProjection } from "@lib/contracts/projections";
import { getSupabaseWriteClient } from "@lib/supabase/writeClient";
import { deriveBatterFantasyPoints, derivePitcherFantasyPoints } from "@lib/scoring/deriveFantasyPoints";
import { DK_CLASSIC_RULES_V1 } from "@lib/contracts/scoring";

export interface PersistPlayerProjectionsGameInput {
  readonly preparedGame: PreparedGameInputs;
  readonly assembledProjection: AssembledGameProjection;
}

export interface PersistPlayerProjectionsInput {
  readonly sourceGames: readonly PersistPlayerProjectionsGameInput[];
  readonly projectedAt: string;
  readonly playerProjectionFormulaVersion: string;
  readonly parameterSetVersion: string;
  readonly preparedInputLineageRef: string;
  readonly teamRunLineageRef: string;
  readonly runId?: string;
  readonly client?: SupabaseClient;
}

export interface PersistPlayerProjectionsSuccess {
  readonly ok: true;
  readonly runId: string;
  readonly projectedAt: string;
  readonly persistedGameCount: number;
  readonly persistedBatterRowCount: number;
  readonly persistedPitcherRowCount: number;
}

export type PersistPlayerProjectionsResult =
  | PersistPlayerProjectionsSuccess
  | { readonly ok: false; readonly error: Error };

// ---------------------------------------------------------------------------
// RPC payload types
//
// All three tables are written inside a single database-side transaction via
// the `persist_projection_run` RPC function. This file defines the shape of
// that call. The SQL function itself lives in the migrations directory.
//
// AtomicProjectionRunPayload is exported so the RPC shape can be tested and
// verified without coupling callers to the internal row structures.
// ---------------------------------------------------------------------------

interface ProjectionRunRow {
  run_id: string;
  projected_at: string;
  player_projection_formula_version: string;
  parameter_set_version: string;
  prepared_input_lineage_ref: string;
  team_run_lineage_ref: string;
}

interface BatterRow {
  run_id: string;
  game_id: string;
  player_id: string;
  team_id: string;
  projected_pa: number;
  projected_ab: number;
  projected_singles: number;
  projected_doubles: number;
  projected_triples: number;
  projected_hr: number;
  projected_rbi: number;
  projected_runs: number;
  projected_bb: number;
  projected_sb: number;
  lineup_path: "confirmed_order" | "season_stats_fallback";
  used_fallback_season_bb_rate: boolean;
  used_fallback_season_hr_rate: boolean;
  used_fallback_season_sb: boolean;
  used_fallback_season_woba: boolean;
  projected_dk_fpts: number;
}

interface PitcherRow {
  run_id: string;
  game_id: string;
  player_id: string;
  team_id: string;
  projected_ip: number;
  projected_k: number;
  projected_er: number;
  projected_hits: number;
  projected_bb: number;
  projected_dk_fpts: number;
}

export interface AtomicProjectionRunPayload {
  readonly run: ProjectionRunRow;
  readonly batters: readonly BatterRow[];
  readonly pitchers: readonly PitcherRow[];
}

// ---------------------------------------------------------------------------
// Batter derivation
// ---------------------------------------------------------------------------

const deriveBatterRow = (
  runId: string,
  batter: BatterProjection,
  prepared: PreparedBatterInputs,
  opponentHandedness: "L" | "R" | "S" | "unknown"
): BatterRow => {
  const lineupStatus = prepared.lineup_status;
  if (lineupStatus !== "confirmed_order" && lineupStatus !== "season_stats_fallback") {
    throw new Error(
      `Unexpected lineup_status "${String(lineupStatus)}" for player_id ${batter.player_id} in game ${batter.game_id}.`
    );
  }

  const lineup_path = lineupStatus === "confirmed_order" ? "confirmed_order" : "season_stats_fallback";
  const isFallback = lineupStatus === "season_stats_fallback";

  const used_fallback_season_bb_rate = isFallback && prepared.season_bb_rate === null;
  const used_fallback_season_hr_rate = isFallback && prepared.season_hr_rate === null;
  const used_fallback_season_sb = isFallback && prepared.season_sb === null;

  let used_fallback_season_woba: boolean;
  if (opponentHandedness === "L") {
    used_fallback_season_woba = isFallback && prepared.vs_lhp_woba === null;
  } else if (opponentHandedness === "R") {
    used_fallback_season_woba = isFallback && prepared.vs_rhp_woba === null;
  } else {
    used_fallback_season_woba = isFallback && prepared.season_woba === null;
  }

  const projected_dk_fpts = deriveBatterFantasyPoints(
    {
      projected_singles: batter.projected_singles,
      projected_doubles: batter.projected_doubles,
      projected_triples: batter.projected_triples,
      projected_hr: batter.projected_hr,
      projected_rbi: batter.projected_rbi,
      projected_runs: batter.projected_runs,
      projected_bb: batter.projected_bb,
      projected_hbp: 0,
      projected_sb: batter.projected_sb,
      projected_cs: 0
    },
    DK_CLASSIC_RULES_V1
  );

  return {
    run_id: runId,
    game_id: batter.game_id,
    player_id: batter.player_id,
    team_id: batter.team_id,
    projected_pa: batter.projected_pa,
    projected_ab: batter.projected_ab,
    projected_singles: batter.projected_singles,
    projected_doubles: batter.projected_doubles,
    projected_triples: batter.projected_triples,
    projected_hr: batter.projected_hr,
    projected_rbi: batter.projected_rbi,
    projected_runs: batter.projected_runs,
    projected_bb: batter.projected_bb,
    projected_sb: batter.projected_sb,
    lineup_path,
    used_fallback_season_bb_rate,
    used_fallback_season_hr_rate,
    used_fallback_season_sb,
    used_fallback_season_woba,
    projected_dk_fpts
  };
};

const buildBatterRows = (
  runId: string,
  batters: readonly BatterProjection[],
  preparedBatters: readonly PreparedBatterInputs[],
  opponentStarter: { readonly handedness: "L" | "R" | "S" | "unknown" } | null,
  gameId: string
): BatterRow[] => {
  const preparedByPlayerId = new Map<string, PreparedBatterInputs>(
    preparedBatters.map((b) => [b.player_id, b])
  );

  return batters.map((batter) => {
    if (batter.game_id !== gameId) {
      throw new Error(
        `Batter row game_id "${batter.game_id}" does not match expected game_id "${gameId}".`
      );
    }

    if (opponentStarter === null) {
      throw new Error(
        `Cannot derive batter fallback fields for player_id ${batter.player_id} in game ${gameId}: opponent starter is missing.`
      );
    }

    const prepared = preparedByPlayerId.get(batter.player_id);
    if (!prepared) {
      throw new Error(
        `No prepared input found for player_id ${batter.player_id} in game ${gameId}.`
      );
    }

    return deriveBatterRow(runId, batter, prepared, opponentStarter.handedness);
  });
};

const buildPitcherRow = (
  runId: string,
  pitcher: PitcherProjection,
  gameId: string
): PitcherRow => {
  if (pitcher.game_id !== gameId) {
    throw new Error(
      `Pitcher row game_id "${pitcher.game_id}" does not match expected game_id "${gameId}".`
    );
  }

  const projected_dk_fpts = derivePitcherFantasyPoints(
    {
      projected_ip: pitcher.projected_ip,
      projected_k: pitcher.projected_k,
      projected_er: pitcher.projected_er,
      projected_hits: pitcher.projected_hits,
      projected_bb: pitcher.projected_bb,
      projected_win_probability: pitcher.win_probability,
      projected_hbp_allowed: 0,
      projected_complete_game: 0,
      projected_shutout: 0,
      projected_no_hitter: 0
    },
    DK_CLASSIC_RULES_V1
  );

  return {
    run_id: runId,
    game_id: pitcher.game_id,
    player_id: pitcher.player_id,
    team_id: pitcher.team_id,
    projected_ip: pitcher.projected_ip,
    projected_k: pitcher.projected_k,
    projected_er: pitcher.projected_er,
    projected_hits: pitcher.projected_hits,
    projected_bb: pitcher.projected_bb,
    projected_dk_fpts
  };
};

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export const persistPlayerProjections = async (
  input: PersistPlayerProjectionsInput
): Promise<PersistPlayerProjectionsResult> => {
  try {
    if (input.sourceGames.length === 0) {
      return {
        ok: false,
        error: new Error("persistPlayerProjections requires at least one source game.")
      };
    }

    const runId = input.runId ?? crypto.randomUUID();
    const client = input.client ?? getSupabaseWriteClient();

    // Build all rows before touching the database. Derivation errors throw
    // and are caught below, returning ok: false before any write occurs.
    const projectionRunRow: ProjectionRunRow = {
      run_id: runId,
      projected_at: input.projectedAt,
      player_projection_formula_version: input.playerProjectionFormulaVersion,
      parameter_set_version: input.parameterSetVersion,
      prepared_input_lineage_ref: input.preparedInputLineageRef,
      team_run_lineage_ref: input.teamRunLineageRef
    };

    const allBatterRows: BatterRow[] = [];
    const allPitcherRows: PitcherRow[] = [];

    for (const { preparedGame, assembledProjection } of input.sourceGames) {
      const gameId = preparedGame.game_id;

      const awayBatterRows = buildBatterRows(
        runId,
        assembledProjection.away_batters,
        preparedGame.away_batters,
        preparedGame.home_starter,
        gameId
      );

      const homeBatterRows = buildBatterRows(
        runId,
        assembledProjection.home_batters,
        preparedGame.home_batters,
        preparedGame.away_starter,
        gameId
      );

      allBatterRows.push(...awayBatterRows, ...homeBatterRows);

      if (assembledProjection.away_pitcher !== null) {
        allPitcherRows.push(buildPitcherRow(runId, assembledProjection.away_pitcher, gameId));
      }

      if (assembledProjection.home_pitcher !== null) {
        allPitcherRows.push(buildPitcherRow(runId, assembledProjection.home_pitcher, gameId));
      }
    }

    // Single atomic write boundary.
    //
    // The `persist_projection_run` database function writes projection_run,
    // player_projection_batter, and player_projection_pitcher in one
    // transaction. All three tables are written or none are. There is no
    // partial-success path.
    //
    // If this RPC has not yet been deployed to the database, this call will
    // fail with a function-not-found error. That failure is the correct
    // runtime behavior. Do not add fallback multi-step inserts.
    const payload: AtomicProjectionRunPayload = {
      run: projectionRunRow,
      batters: allBatterRows,
      pitchers: allPitcherRows
    };

    const rpcResult = await client.rpc("persist_projection_run", payload);

    if (rpcResult.error) {
      // Surface the full Supabase error including code and hint so callers
      // can distinguish missing-function (PGRST202), permission-denied (42501),
      // JWT-expired / wrong-key (401 / PGRST301), and constraint violations.
      const e = rpcResult.error;
      const detail = [
        e.message,
        e.code ? `code=${e.code}` : null,
        e.hint ? `hint=${e.hint}` : null
      ]
        .filter(Boolean)
        .join(" | ");
      return {
        ok: false,
        error: new Error(`persist_projection_run RPC failed: ${detail}`)
      };
    }

    return {
      ok: true,
      runId,
      projectedAt: input.projectedAt,
      persistedGameCount: input.sourceGames.length,
      persistedBatterRowCount: allBatterRows.length,
      persistedPitcherRowCount: allPitcherRows.length
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err : new Error(String(err))
    };
  }
};
