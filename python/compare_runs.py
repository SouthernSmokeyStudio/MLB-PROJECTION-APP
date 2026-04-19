"""
Compare two accuracy artifact JSON files produced by run_manual.py.

Usage:
    python compare_runs.py artifacts/2026-04-17__run_a.json artifacts/2026-04-18__run_b.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def load(path: str) -> dict:
    p = Path(path)
    if not p.exists():
        print(f"ERROR: File not found: {path}")
        sys.exit(1)
    return json.loads(p.read_text())


def index_metrics(artifact: dict) -> dict[tuple[str, str], dict]:
    return {
        (m["projection_role"], m["stat_name"]): m
        for m in artifact.get("metrics", [])
    }


def fmt(v: object) -> str:
    if v is None or (isinstance(v, float) and v != v):  # NaN check
        return "   NaN"
    return f"{float(v):+.4f}" if isinstance(v, (int, float)) else str(v)


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: python compare_runs.py <artifact_a.json> <artifact_b.json>")
        sys.exit(1)

    a = load(sys.argv[1])
    b = load(sys.argv[2])

    print(f"A  {a['harness_run_id']}  date={a['date']}  rows_proj={a['fact_projection_rows']}  rows_act={a['fact_actuals_rows']}")
    print(f"B  {b['harness_run_id']}  date={b['date']}  rows_proj={b['fact_projection_rows']}  rows_act={b['fact_actuals_rows']}")
    print()

    ma = index_metrics(a)
    mb = index_metrics(b)
    all_keys = sorted(set(ma) | set(mb))

    header = f"{'role':<10} {'stat':<14} {'metric':<12} {'A':>10} {'B':>10} {'delta':>10}"
    print(header)
    print("-" * len(header))

    for key in all_keys:
        role, stat = key
        row_a = ma.get(key, {})
        row_b = mb.get(key, {})
        for metric in ("mae", "rmse", "bias", "hit_rate", "pearson_r"):
            va = row_a.get(metric)
            vb = row_b.get(metric)
            if va is None and vb is None:
                continue
            delta = (float(vb) - float(va)) if va is not None and vb is not None else None
            delta_str = fmt(delta) if delta is not None else "   N/A"
            va_str = f"{float(va):.4f}" if va is not None else "   N/A"
            vb_str = f"{float(vb):.4f}" if vb is not None else "   N/A"
            print(f"{role:<10} {stat:<14} {metric:<12} {va_str:>10} {vb_str:>10} {delta_str:>10}")
        print()


if __name__ == "__main__":
    main()
