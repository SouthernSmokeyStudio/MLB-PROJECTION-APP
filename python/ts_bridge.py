"""
TypeScript → Python projection bridge.

Reads public.player_projection_batter / public.player_projection_pitcher
and converts them into the harness-compatible projection_output DataFrame
expected by build_fact_projection_stage.

ID translation rules (deterministic, no lookup table needed):
  player_id : "mlb-543037"            → mlb_player_id : 543037
  game_id   : "mlb-YYYY-MM-DD-aw-hm" → game_pk        : MLB Stats API integer

Column mapping:
  Batter  → projection_role "hitter"
  Pitcher → projection_role "pitcher"
"""
from __future__ import annotations

import logging
from typing import Any

import pandas as pd
import requests
from sqlalchemy import Engine, text

logger = logging.getLogger(__name__)

MLB_SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule"

_GAME_PK_CACHE: dict[str, int | None] = {}

# MLB Stats API uses non-standard abbreviations for some franchises.
# Map from slug abbr → API abbr so matching survives these mismatches.
_ABBR_ALIASES: dict[str, str] = {
    "ARI": "AZ",   # Arizona Diamondbacks: slug uses ARI, API returns AZ
}


def player_id_to_mlb_id(ts_player_id: str) -> int:
    """'mlb-543037' or '543037' → 543037. Raises ValueError if format is wrong."""
    if ts_player_id.startswith("mlb-"):
        return int(ts_player_id[4:])
    try:
        return int(ts_player_id)
    except ValueError:
        raise ValueError(f"Unexpected player_id format: {ts_player_id!r}")


def game_id_to_game_pk(ts_game_id: str, http_session: requests.Session | None = None) -> int | None:
    """
    'mlb-2026-04-17-det-nyy' → numeric game_pk from MLB Stats API.

    Parses the slug for date + team abbreviations, then calls
    /v1/schedule to match. Results are in-process cached.
    """
    if ts_game_id in _GAME_PK_CACHE:
        return _GAME_PK_CACHE[ts_game_id]

    parts = ts_game_id.split("-")
    if len(parts) < 6 or parts[0] != "mlb":
        logger.warning("game_id_to_game_pk_bad_format", extra={"game_id": ts_game_id})
        _GAME_PK_CACHE[ts_game_id] = None
        return None

    date_str = f"{parts[1]}-{parts[2]}-{parts[3]}"
    away_abbr = _ABBR_ALIASES.get(parts[4].upper(), parts[4].upper())
    home_abbr = _ABBR_ALIASES.get(parts[5].upper(), parts[5].upper())

    session = http_session or requests.Session()
    try:
        resp = session.get(
            MLB_SCHEDULE_URL,
            params={"sportId": 1, "date": date_str, "hydrate": "team"},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.warning("game_id_to_game_pk_fetch_failed", extra={"game_id": ts_game_id, "error": str(exc)})
        _GAME_PK_CACHE[ts_game_id] = None
        return None

    for game_date in data.get("dates", []):
        for game in game_date.get("games", []):
            teams = game.get("teams", {})
            a = teams.get("away", {}).get("team", {}).get("abbreviation", "").upper()
            h = teams.get("home", {}).get("team", {}).get("abbreviation", "").upper()
            if a == away_abbr and h == home_abbr:
                game_pk = game.get("gamePk")
                _GAME_PK_CACHE[ts_game_id] = game_pk
                return game_pk

    logger.warning(
        "game_id_to_game_pk_no_match",
        extra={"game_id": ts_game_id, "date": date_str, "away": away_abbr, "home": home_abbr},
    )
    _GAME_PK_CACHE[ts_game_id] = None
    return None


def _read_ts_batters(engine: Engine, ts_run_id: str) -> pd.DataFrame:
    query = text(
        """
        SELECT
            game_id,
            player_id,
            team_id,
            projected_pa,
            projected_singles,
            projected_doubles,
            projected_triples,
            projected_hr,
            projected_rbi,
            projected_runs,
            projected_bb,
            projected_sb,
            projected_dk_fpts
        FROM public.player_projection_batter
        WHERE run_id = CAST(:run_id AS uuid)
        """
    )
    return pd.read_sql_query(query, engine, params={"run_id": ts_run_id})


def _read_ts_pitchers(engine: Engine, ts_run_id: str) -> pd.DataFrame:
    query = text(
        """
        SELECT
            game_id,
            player_id,
            team_id,
            projected_ip,
            projected_k,
            projected_er,
            projected_hits  AS projected_hits_allowed,
            projected_bb    AS projected_bb_pitching,
            projected_dk_fpts
        FROM public.player_projection_pitcher
        WHERE run_id = CAST(:run_id AS uuid)
        """
    )
    return pd.read_sql_query(query, engine, params={"run_id": ts_run_id})


def build_projection_output(
    engine: Engine,
    ts_run_id: str,
    harness_run_id: str,
    http_session: requests.Session | None = None,
) -> pd.DataFrame:
    """
    Read TypeScript projection tables for ts_run_id and return a DataFrame
    ready for build_fact_projection_stage.

    Rows with unparseable player_id or unresolvable game_pk are dropped with
    a warning.
    """
    batters = _read_ts_batters(engine, ts_run_id)
    pitchers = _read_ts_pitchers(engine, ts_run_id)

    rows: list[dict[str, Any]] = []

    for _, row in batters.iterrows():
        try:
            mlb_player_id = player_id_to_mlb_id(str(row["player_id"]))
        except ValueError as exc:
            logger.warning("ts_bridge_bad_player_id", extra={"player_id": row["player_id"], "error": str(exc)})
            continue

        game_pk = game_id_to_game_pk(str(row["game_id"]), http_session)
        if game_pk is None:
            logger.warning("ts_bridge_no_game_pk", extra={"game_id": row["game_id"]})
            continue

        rows.append(
            {
                "run_id": harness_run_id,
                "mlb_player_id": mlb_player_id,
                "game_pk": game_pk,
                "projection_role": "hitter",
                "projected_pa": row.get("projected_pa"),
                "projected_singles": row.get("projected_singles"),
                "projected_doubles": row.get("projected_doubles"),
                "projected_triples": row.get("projected_triples"),
                "projected_hr": row.get("projected_hr"),
                "projected_rbi": row.get("projected_rbi"),
                "projected_runs": row.get("projected_runs"),
                "projected_bb_batting": row.get("projected_bb"),
                "projected_sb": row.get("projected_sb"),
                "projected_dk_fpts": row.get("projected_dk_fpts"),
                # Pitcher columns null for hitters
                "projected_ip": None,
                "projected_bf": None,
                "projected_k": None,
                "projected_bb_pitching": None,
                "projected_hits_allowed": None,
                "projected_hr_allowed": None,
                "projected_er": None,
                "projected_hbp_batting": None,
                "projected_hbp_pitching": None,
                "projected_cs": None,
            }
        )

    for _, row in pitchers.iterrows():
        try:
            mlb_player_id = player_id_to_mlb_id(str(row["player_id"]))
        except ValueError as exc:
            logger.warning("ts_bridge_bad_player_id", extra={"player_id": row["player_id"], "error": str(exc)})
            continue

        game_pk = game_id_to_game_pk(str(row["game_id"]), http_session)
        if game_pk is None:
            logger.warning("ts_bridge_no_game_pk", extra={"game_id": row["game_id"]})
            continue

        rows.append(
            {
                "run_id": harness_run_id,
                "mlb_player_id": mlb_player_id,
                "game_pk": game_pk,
                "projection_role": "pitcher",
                "projected_ip": row.get("projected_ip"),
                "projected_k": row.get("projected_k"),
                "projected_bb_pitching": row.get("projected_bb_pitching"),
                "projected_hits_allowed": row.get("projected_hits_allowed"),
                "projected_er": row.get("projected_er"),
                "projected_dk_fpts": row.get("projected_dk_fpts"),
                # Batter columns null for pitchers
                "projected_pa": None,
                "projected_bf": None,
                "projected_bb_batting": None,
                "projected_singles": None,
                "projected_doubles": None,
                "projected_triples": None,
                "projected_hr": None,
                "projected_rbi": None,
                "projected_runs": None,
                "projected_sb": None,
                "projected_cs": None,
                "projected_hbp_batting": None,
                "projected_hbp_pitching": None,
                "projected_hr_allowed": None,
            }
        )

    df = pd.DataFrame(rows)
    logger.info(
        "ts_bridge_built_projection_output",
        extra={
            "ts_run_id": ts_run_id,
            "batter_rows": len(batters),
            "pitcher_rows": len(pitchers),
            "output_rows": len(df),
        },
    )
    return df


def latest_ts_run_id(engine: Engine) -> str | None:
    """Return the most recent projection_run UUID from the TypeScript tables."""
    query = text("SELECT run_id FROM public.projection_run ORDER BY projected_at DESC LIMIT 1")
    with engine.connect() as conn:
        row = conn.execute(query).mappings().first()
    if row is None:
        return None
    return str(row["run_id"])
