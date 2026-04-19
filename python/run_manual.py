"""
Manual one-shot accuracy pipeline.

Reads the most recent (or specified) TypeScript projection run, bridges it
to the sss_mlb harness schema, fetches MLB actuals, and writes error metrics.

Usage:
    python run_manual.py [TS_RUN_ID]

If TS_RUN_ID is omitted, uses the most recent projection_run UUID.

Prerequisites:
    1. python/harness.env exists with valid POSTGRES_DSN + config keys
    2. At least one row in public.projection_run (run seed_test_run.py if not)
    3. pip install -r requirements.txt (from this directory)

Output:
    Prints aggregated error metrics to stdout.
    Writes fact_projection and fact_actuals rows to sss_mlb schema.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Add this directory (python/) and all stage packages to sys.path
_this_dir = Path(__file__).parent
_repo_root = _this_dir.parent
if str(_this_dir) not in sys.path:
    sys.path.insert(0, str(_this_dir))
for _pkg_dir in [
    "sss_mlb_harness_v6",
    "sss_mlb_fact_projection_v3/sss_mlb_fact_projection_v3",
    "sss_mlb_fact_actuals_v3/sss_mlb_fact_actuals_v3",
    "sss_mlb_error_metrics_v3/sss_mlb_error_metrics_v3",
    "sss_mlb_dim_player_v2/sss_mlb_dim_player_v2",
    "sss_mlb_identity_crosswalk_v3/sss_mlb_identity_crosswalk_v2",
]:
    _p = _repo_root / _pkg_dir
    if str(_p.parent) not in sys.path:
        sys.path.insert(0, str(_p.parent))

import logging
from typing import Any

import pandas as pd
import requests
from sqlalchemy import Engine, create_engine, text

from sss_mlb_harness_v6.config import load_runtime_config
from sss_mlb_harness_v6.manifest import (
    RunManifestRow,
    finish_run_manifest,
    get_git_commit_hash,
    mark_run_failed,
    start_run_manifest,
)
from sss_mlb_harness_v6.source_snapshot import SourceSnapshotRow, build_http_clients

from sss_mlb_fact_projection_v3.fact_projection import build_fact_projection_stage  # type: ignore[import]
from sss_mlb_fact_actuals_v3.fact_actuals import build_fact_actuals_stage  # type: ignore[import]
from sss_mlb_error_metrics_v3.error_metrics import aggregate_error_metrics, compute_row_level_errors  # type: ignore[import]
from sss_mlb_dim_player_v2.dim_player import build_dim_player_stage  # type: ignore[import]

from ts_bridge import build_projection_output, latest_ts_run_id

ENV_PATH = Path(__file__).parent / "harness.env"
ARTIFACTS_DIR = Path(__file__).parent / "artifacts"

logger = logging.getLogger(__name__)


def seed_identity_crosswalk(
    engine: Engine,
    harness_run_id: str,
    projection_df: pd.DataFrame,
) -> None:
    """
    Populate sss_mlb.identity_crosswalk directly from the projection DataFrame.

    For a manual/seed run the full DK draftables crosswalk is unavailable, so
    we insert minimal rows keyed only on mlb_player_id + game_pk.  The
    dim_player stage will enrich these via the MLB people API.
    """
    if projection_df.empty:
        return

    player_game_pairs = (
        projection_df[["mlb_player_id", "game_pk"]]
        .drop_duplicates()
    )

    rows = []
    for _, row in player_game_pairs.iterrows():
        rows.append(
            {
                "run_id": harness_run_id,
                "slate_date": "2000-01-01",  # placeholder; will be overwritten by dim_player enrichment
                "game_pk": int(row["game_pk"]),
                "mlb_player_id": int(row["mlb_player_id"]),
                "dk_player_id": None,
                "dk_draftable_id": None,
                "canonical_full_name": f"player-{row['mlb_player_id']}",
                "source_full_name": None,
                "team_abbr": None,
                "opp_abbr": None,
                "game_start_utc": None,
                "resolution_method": "ts_bridge_direct",
                "identity_confidence": 1.0,
                "blocked_flag": False,
                "blocked_reason": None,
                "active_flag": True,
            }
        )

    stmt = text(
        """
        INSERT INTO sss_mlb.identity_crosswalk (
            run_id, slate_date, game_pk, mlb_player_id,
            dk_player_id, dk_draftable_id, canonical_full_name,
            source_full_name, team_abbr, opp_abbr, game_start_utc,
            resolution_method, identity_confidence, blocked_flag, blocked_reason, active_flag
        )
        VALUES (
            :run_id, CAST(:slate_date AS date), :game_pk, :mlb_player_id,
            :dk_player_id, :dk_draftable_id, :canonical_full_name,
            :source_full_name, :team_abbr, :opp_abbr, :game_start_utc,
            :resolution_method, :identity_confidence, :blocked_flag, :blocked_reason, :active_flag
        )
        ON CONFLICT DO NOTHING
        """
    )
    with engine.begin() as conn:
        conn.execute(stmt, rows)

    logger.info(
        "seeded_identity_crosswalk",
        extra={"harness_run_id": harness_run_id, "rows": len(rows)},
    )


def seed_dim_game(
    engine: Engine,
    harness_run_id: str,
    projection_df: pd.DataFrame,
    http_session: requests.Session,
) -> None:
    """
    Populate sss_mlb.dim_game for each unique game_pk in the projection.
    Requires a slate_resolution row first (minimal stub inserted here).
    """
    if projection_df.empty:
        return

    game_pks = projection_df["game_pk"].dropna().unique()

    for game_pk in game_pks:
        game_pk = int(game_pk)

        # Minimal slate_resolution stub (no DK data available in manual run)
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO sss_mlb.slate_resolution (
                        run_id, draft_group_id, slate_date, dk_game_id, game_pk,
                        scoring_rules_version, mapping_confidence, blocked_flag, blocked_reason
                    )
                    VALUES (
                        :run_id, :draft_group_id, CAST(:slate_date AS date), :dk_game_id, :game_pk,
                        'DK_CLASSIC_V1', 1.0, TRUE, 'manual_seed_no_dk_data'
                    )
                    ON CONFLICT DO NOTHING
                    """
                ),
                {
                    "run_id": harness_run_id,
                    "draft_group_id": game_pk,  # stub: use game_pk as surrogate
                    "slate_date": "2000-01-01",
                    "dk_game_id": game_pk,  # stub
                    "game_pk": game_pk,
                },
            )

        # Fetch game info from MLB schedule API (hydrate=team gives abbreviations + gameDate)
        try:
            resp = http_session.get(
                "https://statsapi.mlb.com/api/v1/schedule",
                params={"gamePks": game_pk, "hydrate": "team,venue"},
                timeout=15,
            )
            resp.raise_for_status()
            sched_data = resp.json()
        except Exception as exc:
            logger.warning("seed_dim_game_fetch_failed", extra={"game_pk": game_pk, "error": str(exc)})
            continue

        away_abbr = "UNK"
        home_abbr = "UNK"
        game_start_utc = None
        venue_name = None
        for game_date in sched_data.get("dates", []):
            for game in game_date.get("games", []):
                if game.get("gamePk") == game_pk:
                    t = game.get("teams", {})
                    away_abbr = t.get("away", {}).get("team", {}).get("abbreviation", "UNK")
                    home_abbr = t.get("home", {}).get("team", {}).get("abbreviation", "UNK")
                    game_start_utc = game.get("gameDate")
                    venue_name = game.get("venue", {}).get("name")
                    break

        # Fetch slate_resolution_id for this game_pk
        with engine.begin() as conn:
            row = conn.execute(
                text("SELECT slate_resolution_id FROM sss_mlb.slate_resolution WHERE run_id = :r AND game_pk = :g"),
                {"r": harness_run_id, "g": game_pk},
            ).mappings().first()
            if row is None:
                continue
            slate_resolution_id = row["slate_resolution_id"]

            conn.execute(
                text(
                    """
                    INSERT INTO sss_mlb.dim_game (
                        run_id, slate_resolution_id, game_pk, dk_game_id,
                        away_team_abbr, home_team_abbr, game_start_utc, venue_name
                    )
                    VALUES (
                        :run_id, :slate_resolution_id, :game_pk, :dk_game_id,
                        :away, :home, :game_start_utc, :venue_name
                    )
                    ON CONFLICT (game_pk) DO UPDATE SET
                        away_team_abbr = EXCLUDED.away_team_abbr,
                        home_team_abbr = EXCLUDED.home_team_abbr,
                        game_start_utc = EXCLUDED.game_start_utc,
                        updated_at_utc = NOW()
                    """
                ),
                {
                    "run_id": harness_run_id,
                    "slate_resolution_id": slate_resolution_id,
                    "game_pk": game_pk,
                    "dk_game_id": game_pk,  # stub
                    "away": away_abbr,
                    "home": home_abbr,
                    "game_start_utc": game_start_utc,
                    "venue_name": venue_name,
                },
            )

    logger.info("seeded_dim_game", extra={"run_id": harness_run_id, "game_pks": list(game_pks)})


def read_joined_projection_actuals(engine: Engine, harness_run_id: str) -> pd.DataFrame:
    query = text(
        """
        SELECT
            fp.run_id,
            fp.player_sk,
            fp.game_sk,
            fp.projection_role,
            fp.projected_pa,
            fp.projected_ip,
            fp.projected_bf,
            fp.projected_k,
            fp.projected_bb_batting,
            fp.projected_bb_pitching,
            fp.projected_hits_allowed,
            fp.projected_hr_allowed,
            fp.projected_er,
            fp.projected_singles,
            fp.projected_doubles,
            fp.projected_triples,
            fp.projected_hr,
            fp.projected_rbi,
            fp.projected_runs,
            fp.projected_hbp_batting,
            fp.projected_hbp_pitching,
            fp.projected_sb,
            fp.projected_cs,
            fp.projected_dk_fpts,
            fa.actual_pa,
            fa.actual_ip,
            fa.actual_bf,
            fa.actual_k_batting,
            fa.actual_k_pitching,
            fa.actual_bb_batting,
            fa.actual_bb_pitching,
            fa.actual_hits_allowed,
            fa.actual_hr_allowed,
            fa.actual_er,
            fa.actual_singles,
            fa.actual_doubles,
            fa.actual_triples,
            fa.actual_hr,
            fa.actual_rbi,
            fa.actual_runs,
            fa.actual_hbp_batting,
            fa.actual_hbp_pitching,
            fa.actual_sb,
            fa.actual_cs,
            fa.actual_dk_fpts
        FROM sss_mlb.fact_projection fp
        JOIN sss_mlb.fact_actuals fa
            ON fa.player_sk = fp.player_sk AND fa.game_sk = fp.game_sk
        WHERE fp.run_id = :run_id
        """
    )
    return pd.read_sql_query(query, engine, params={"run_id": harness_run_id})


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run one evaluation cycle: export projections, fetch actuals, compute accuracy."
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--date", metavar="YYYY-MM-DD",
        help="Date to evaluate. Triggers a fresh projection export for that date. "
             "Defaults to RUN_DATE in harness.env.",
    )
    group.add_argument(
        "--ts-run-id", metavar="UUID",
        help="Use an existing TypeScript projection run_id directly (skips export).",
    )
    return parser.parse_args()


def _export_or_resolve_ts_run(
    args: argparse.Namespace,
    engine: Any,
    config: Any,
) -> tuple[str, str]:
    """Return (ts_run_id, run_date_str). Runs the TypeScript exporter via tsx."""
    import subprocess

    # --ts-run-id: use directly, infer date from env
    if args.ts_run_id:
        return args.ts_run_id, str(config.run_date)

    # --date or default: always do a fresh export
    run_date = args.date or str(config.run_date)

    script = _repo_root / "scripts" / "exportProjections.ts"
    if not script.exists():
        print(f"ERROR: Export script not found: {script}")
        sys.exit(1)

    env_file = _repo_root / ".env.local"
    env_flag = f'--env-file "{env_file}"' if env_file.exists() else ""
    print(f"Exporting projections for {run_date} ...")
    result = subprocess.run(
        f'npx tsx {env_flag} "{script}" {run_date}',
        capture_output=True,
        text=True,
        cwd=str(_repo_root),
        timeout=120,
        shell=True,
    )

    if result.returncode != 0:
        print(result.stderr.strip())
        print(f"ERROR: Export script exited with code {result.returncode}")
        sys.exit(1)

    if result.stderr.strip():
        print(result.stderr.strip())

    ts_run_id = result.stdout.strip()
    if not ts_run_id:
        print("ERROR: Export script produced no run_id on stdout.")
        sys.exit(1)

    return ts_run_id, run_date


def _write_artifact(
    harness_run_id: str,
    ts_run_id: str,
    run_date: str,
    fact_proj_rows: int,
    fact_actuals_rows: int,
    metrics_df: "pd.DataFrame | None",
    status: str,
) -> Path:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    slug = harness_run_id.replace("__", "_")
    artifact_path = ARTIFACTS_DIR / f"{run_date}__{slug}.json"
    payload = {
        "harness_run_id": harness_run_id,
        "ts_run_id": ts_run_id,
        "date": run_date,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "fact_projection_rows": fact_proj_rows,
        "fact_actuals_rows": fact_actuals_rows,
        "metrics": metrics_df.to_dict(orient="records") if metrics_df is not None else [],
    }
    artifact_path.write_text(json.dumps(payload, indent=2, default=str))
    return artifact_path


def main() -> None:
    args = _parse_args()

    if not ENV_PATH.exists():
        print(f"ERROR: {ENV_PATH} not found. Copy harness.env.example and fill in POSTGRES_DSN.")
        sys.exit(1)

    config = load_runtime_config(ENV_PATH)
    engine = create_engine(config.postgres_dsn, future=True)
    http_clients = build_http_clients(config)

    ts_run_id, run_date = _export_or_resolve_ts_run(args, engine, config)
    print(f"Bridging TypeScript run: {ts_run_id}")

    git_hash = get_git_commit_hash(_repo_root)
    manifest = start_run_manifest(engine, config, git_hash)
    print(f"Harness run_id: {manifest.run_id}")

    try:
        http_session = http_clients.get("mlb_session") or requests.Session()

        # 1. Build projection_output DataFrame from TypeScript tables
        projection_df = build_projection_output(engine, ts_run_id, manifest.run_id, http_session)
        if projection_df.empty:
            raise RuntimeError("No projection rows after bridge. Check player_id format and game_id resolution.")

        print(f"Bridge output: {len(projection_df)} projection rows")

        # 2. Seed identity_crosswalk and dim tables (manual run shortcut)
        seed_identity_crosswalk(engine, manifest.run_id, projection_df)
        build_dim_player_stage(engine, config, manifest, http_clients, [])
        seed_dim_game(engine, manifest.run_id, projection_df, http_session)

        # 3. Write fact_projection
        fact_proj_result = build_fact_projection_stage(
            engine=engine,
            config=config,
            manifest=manifest,
            http_clients=http_clients,
            snapshots=[],
            projection_output=projection_df,
        )
        print(f"fact_projection: {fact_proj_result.row_count_summary_json}")

        # 4. Fetch and write actuals
        fact_actuals_result = build_fact_actuals_stage(
            engine=engine,
            config=config,
            manifest=manifest,
            http_clients=http_clients,
            snapshots=[],
        )
        print(f"fact_actuals: {fact_actuals_result.row_count_summary_json}")

        # 5. Compute error metrics
        joined_df = read_joined_projection_actuals(engine, manifest.run_id)
        metrics_df: "pd.DataFrame | None" = None
        if joined_df.empty:
            print("WARNING: No joined projection+actuals rows. Error metrics unavailable.")
        else:
            error_df = compute_row_level_errors(joined_df)
            metrics_df = aggregate_error_metrics(error_df)
            print("\n--- Accuracy Report ---")
            print(metrics_df.to_string(index=False))

        # Merge sub-results for manifest
        combined_status = (
            "completed"
            if fact_proj_result.status == "completed" and fact_actuals_result.status == "completed"
            else "partial"
        )
        finish_run_manifest(
            engine=engine,
            run_id=manifest.run_id,
            status=combined_status,
            actuals_state="actuals_completed",
            row_count_summary_json={
                **fact_proj_result.row_count_summary_json,
                **fact_actuals_result.row_count_summary_json,
            },
            blocked_sections=fact_proj_result.blocked_sections + fact_actuals_result.blocked_sections,
            warnings_json=fact_proj_result.warnings_json + fact_actuals_result.warnings_json,
        )

        artifact_path = _write_artifact(
            harness_run_id=manifest.run_id,
            ts_run_id=ts_run_id,
            run_date=run_date,
            fact_proj_rows=fact_proj_result.row_count_summary_json.get("fact_projection_rows", 0),
            fact_actuals_rows=fact_actuals_result.row_count_summary_json.get("fact_actuals_rows", 0),
            metrics_df=metrics_df,
            status=combined_status,
        )
        print(f"\nRun complete. Status: {combined_status}")
        print(f"Artifact: {artifact_path}")

    except Exception as exc:
        try:
            mark_run_failed(engine, manifest.run_id, str(exc))
        except Exception:
            pass
        raise
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
