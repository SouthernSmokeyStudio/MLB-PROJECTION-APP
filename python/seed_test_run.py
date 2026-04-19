"""
Seed the TypeScript projection tables with one real completed MLB game.

Usage:
    python seed_test_run.py [YYYY-MM-DD]

If no date is given, defaults to yesterday. Finds the first completed
regular-season game on that date, reads its boxscore to get real player IDs,
inserts baseline projections, and prints the TS_RUN_ID created.

Only for manual end-to-end harness testing. Do not use in production.
"""
from __future__ import annotations

import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
from dotenv import dotenv_values
from sqlalchemy import create_engine, text

_ENV_PATH = Path(__file__).parent / "harness.env"

MLB_SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule"
MLB_BOXSCORE_URL = "https://statsapi.mlb.com/api/v1/game/{game_pk}/boxscore"

BASELINE_BATTER = {
    "projected_pa": 4.0,
    "projected_ab": 3.6,
    "projected_singles": 0.55,
    "projected_doubles": 0.12,
    "projected_triples": 0.01,
    "projected_hr": 0.07,
    "projected_rbi": 0.30,
    "projected_runs": 0.35,
    "projected_bb": 0.30,
    "projected_sb": 0.04,
    "projected_dk_fpts": 5.5,
    "lineup_path": "season_stats_fallback",
    "used_fallback_season_bb_rate": True,
    "used_fallback_season_hr_rate": True,
    "used_fallback_season_sb": True,
    "used_fallback_season_woba": True,
}

BASELINE_PITCHER = {
    "projected_ip": 5.5,
    "projected_k": 6.0,
    "projected_er": 2.5,
    "projected_hits": 5.0,
    "projected_bb": 2.0,
    "projected_dk_fpts": 20.0,
}


def _load_dsn() -> str:
    if not _ENV_PATH.exists():
        raise FileNotFoundError(
            f"{_ENV_PATH} not found. Copy harness.env.example to harness.env and set POSTGRES_DSN."
        )
    raw = dotenv_values(_ENV_PATH)
    dsn = raw.get("POSTGRES_DSN")
    if not dsn:
        raise ValueError("POSTGRES_DSN not set in harness.env")
    return str(dsn)


def fetch_game_pk_for_date(run_date: date):
    """Return (game_pk, away_abbr, home_abbr) for the first Final game on run_date, or None."""
    resp = requests.get(
        MLB_SCHEDULE_URL,
        params={"sportId": 1, "date": run_date.isoformat(), "gameType": "R", "hydrate": "team"},
        timeout=15,
    )
    resp.raise_for_status()
    for game_date in resp.json().get("dates", []):
        for game in game_date.get("games", []):
            if game.get("status", {}).get("abstractGameState") == "Final":
                teams = game.get("teams", {})
                away = teams.get("away", {}).get("team", {}).get("abbreviation", "TBD").lower()
                home = teams.get("home", {}).get("team", {}).get("abbreviation", "TBD").lower()
                return game["gamePk"], away, home
    return None


def fetch_boxscore(game_pk: int) -> dict:
    resp = requests.get(MLB_BOXSCORE_URL.format(game_pk=game_pk), timeout=15)
    resp.raise_for_status()
    return resp.json()


def extract_players(boxscore: dict):
    """Return (batters, pitchers) each as list of {mlb_player_id, team_abbr}."""
    batters: list[dict] = []
    pitchers: list[dict] = []
    for side in ("away", "home"):
        team_abbr = (
            boxscore.get("teams", {})
            .get(side, {})
            .get("team", {})
            .get("abbreviation", side)
            .lower()
        )
        for _, player in boxscore.get("teams", {}).get(side, {}).get("players", {}).items():
            person_id = player.get("person", {}).get("id")
            if not person_id:
                continue
            batting = player.get("stats", {}).get("batting", {}) or {}
            pitching = player.get("stats", {}).get("pitching", {}) or {}
            pa = batting.get("plateAppearances") or 0
            ip_raw = pitching.get("inningsPitched")
            ip = float(ip_raw) if ip_raw else 0.0
            if pa > 0:
                batters.append({"mlb_player_id": person_id, "team_abbr": team_abbr})
            if ip > 0:
                pitchers.append({"mlb_player_id": person_id, "team_abbr": team_abbr})
    return batters, pitchers


def seed_run(engine, run_date: date, game_pk: int, away_abbr: str, home_abbr: str) -> str:
    boxscore = fetch_boxscore(game_pk)
    batters, pitchers = extract_players(boxscore)
    if not batters and not pitchers:
        raise RuntimeError(f"No players found in boxscore for game_pk={game_pk}")

    game_id = f"mlb-{run_date.isoformat()}-{away_abbr}-{home_abbr}"
    run_id = uuid.uuid4()
    projected_at = datetime.now(timezone.utc).isoformat()

    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO public.projection_run"
                " (run_id, projected_at, player_projection_formula_version,"
                "  parameter_set_version, prepared_input_lineage_ref, team_run_lineage_ref)"
                " VALUES"
                " (:run_id, :projected_at, 'seed-v1', 'baseline-v1', 'seed', 'seed')"
            ),
            {"run_id": str(run_id), "projected_at": projected_at},
        )

        for b in batters:
            conn.execute(
                text(
                    "INSERT INTO public.player_projection_batter"
                    " (run_id, game_id, player_id, team_id,"
                    "  projected_pa, projected_ab, projected_singles, projected_doubles,"
                    "  projected_triples, projected_hr, projected_rbi, projected_runs,"
                    "  projected_bb, projected_sb, lineup_path,"
                    "  used_fallback_season_bb_rate, used_fallback_season_hr_rate,"
                    "  used_fallback_season_sb, used_fallback_season_woba, projected_dk_fpts)"
                    " VALUES"
                    " (:run_id, :game_id, :player_id, :team_id,"
                    "  :projected_pa, :projected_ab, :projected_singles, :projected_doubles,"
                    "  :projected_triples, :projected_hr, :projected_rbi, :projected_runs,"
                    "  :projected_bb, :projected_sb, :lineup_path,"
                    "  :used_fallback_season_bb_rate, :used_fallback_season_hr_rate,"
                    "  :used_fallback_season_sb, :used_fallback_season_woba, :projected_dk_fpts)"
                    " ON CONFLICT DO NOTHING"
                ),
                {
                    "run_id": str(run_id),
                    "game_id": game_id,
                    "player_id": f"mlb-{b['mlb_player_id']}",
                    "team_id": b["team_abbr"],
                    **BASELINE_BATTER,
                },
            )

        for p in pitchers:
            conn.execute(
                text(
                    "INSERT INTO public.player_projection_pitcher"
                    " (run_id, game_id, player_id, team_id,"
                    "  projected_ip, projected_k, projected_er,"
                    "  projected_hits, projected_bb, projected_dk_fpts)"
                    " VALUES"
                    " (:run_id, :game_id, :player_id, :team_id,"
                    "  :projected_ip, :projected_k, :projected_er,"
                    "  :projected_hits, :projected_bb, :projected_dk_fpts)"
                    " ON CONFLICT DO NOTHING"
                ),
                {
                    "run_id": str(run_id),
                    "game_id": game_id,
                    "player_id": f"mlb-{p['mlb_player_id']}",
                    "team_id": p["team_abbr"],
                    **BASELINE_PITCHER,
                },
            )

    print(f"Seeded run_id={run_id}")
    print(f"  game_pk={game_pk}  {away_abbr.upper()} @ {home_abbr.upper()}")
    print(f"  {len(batters)} batters, {len(pitchers)} pitchers")
    print()
    print(f"TS_RUN_ID={run_id}")
    return str(run_id)


def main() -> None:
    if len(sys.argv) > 1:
        try:
            run_date = date.fromisoformat(sys.argv[1])
        except ValueError:
            print(f"ERROR: Invalid date {sys.argv[1]!r}. Use YYYY-MM-DD.")
            sys.exit(1)
    else:
        run_date = date.today() - timedelta(days=1)

    print(f"Looking for completed games on {run_date.isoformat()} ...")
    result = fetch_game_pk_for_date(run_date)
    if result is None:
        print(f"No completed regular-season games found for {run_date.isoformat()}. Try an earlier date.")
        sys.exit(1)

    game_pk, away, home = result
    print(f"Found: game_pk={game_pk}  {away.upper()} @ {home.upper()}")

    engine = create_engine(_load_dsn(), future=True)
    try:
        seed_run(engine, run_date, game_pk, away, home)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
