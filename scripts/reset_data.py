#!/usr/bin/env python3
"""Clear transactional data for fresh upload testing."""

from __future__ import annotations

import csv
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "output"
PUBLIC = ROOT / "public" / "data"
RAW = ROOT / "data" / "raw"
UPLOADS = ROOT / "data" / "uploads"

from data_stores import DATA_STORES

UNIFIED_HEADERS = [
    "date",
    "gl_account",
    "amount",
    "description",
    "opco",
    "project_id",
    "source_system",
    "gl_category",
    "city",
]
WIP_HEADERS = [
    "project_id",
    "project_name",
    "opco",
    "contract_value",
    "wip_to_date",
    "pct_complete",
    "milestone_name",
    "milestone_pct",
    "milestone_billing",
    "scheduled_week",
    "customer_segment",
    "city",
]
GL_HEADERS = ["gl_account", "category", "description"]
GL_MAP_HEADERS = ["gl_account", "category", "status"]


def write_csv_headers(path: Path, headers: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerow(headers)


def clear_uploads() -> None:
    if UPLOADS.exists():
        shutil.rmtree(UPLOADS)
    UPLOADS.mkdir(parents=True, exist_ok=True)
    (UPLOADS / ".gitkeep").write_text("", encoding="utf-8")


def clear_raw_exports() -> None:
    for name in ("gilde_export.csv", "yuki_export.csv", "exact_export.csv"):
        path = RAW / name
        if path.exists():
            path.unlink()


def write_empty_json_outputs() -> None:
    empty_forecast = {"base": [], "wet": [], "dry": []}
    empty_weather = {
        "fetchedAt": None,
        "source": "Open-Meteo",
        "timezone": "Europe/Amsterdam",
        "horizonWeeks": 13,
        "weekStart": None,
        "summary": "No weather data yet — run npm run data:weather after adding opco locations",
        "topHighlights": [],
        "cities": [],
    }
    for folder in (OUT, PUBLIC):
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "forecast.json").write_text(json.dumps(empty_forecast, indent=2), encoding="utf-8")
        (folder / "trace_data.json").write_text("[]\n", encoding="utf-8")
        (folder / "wip_data.json").write_text("[]\n", encoding="utf-8")
        (folder / "weather_insights.json").write_text(json.dumps(empty_weather, indent=2), encoding="utf-8")
        covenant = json.loads((RAW / "covenant_terms.json").read_text(encoding="utf-8"))
        threshold = covenant.get("headroom_threshold_eur", 500_000)
        summary = {
            "headroomThresholdEur": threshold,
            "interestCoverageRatio": covenant.get("current_interest_coverage", 3.5),
            "interestCoverageMinimum": covenant.get("interest_coverage_minimum", 2.5),
            "headroomByScenario": {"base": threshold, "wet": threshold, "dry": threshold},
            "wetQuarterEarlyWeeksWorse": False,
            "dryQuarterEarlyWeeksBetter": False,
        }
        (folder / "covenant_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")


def main() -> int:
    print("Resetting Altis central database and upload staging…")

    write_csv_headers(OUT / "unified_data.csv", UNIFIED_HEADERS)
    for meta in DATA_STORES.values():
        write_csv_headers(OUT / meta["file"], UNIFIED_HEADERS)
    write_csv_headers(OUT / "gl_mapping.csv", GL_MAP_HEADERS)
    write_csv_headers(RAW / "gl_account_mapping.csv", GL_HEADERS)
    write_csv_headers(RAW / "projects_wip.csv", WIP_HEADERS)
    (OUT / "data_notes.txt").write_text(
        "Unified data — empty. Upload Excel/CSV via Data Ingest to populate.\n",
        encoding="utf-8",
    )

    clear_raw_exports()
    clear_uploads()

    publish = ["unified_data.csv", "gl_mapping.csv", "data_notes.txt", *[m["file"] for m in DATA_STORES.values()]]
    for name in publish:
        src = OUT / name
        if src.exists():
            PUBLIC.mkdir(parents=True, exist_ok=True)
            (PUBLIC / name).write_text(src.read_text(encoding="utf-8"), encoding="utf-8")

    forecast_script = ROOT / "scripts" / "forecast.py"
    py = ROOT / ".venv" / "bin" / "python"
    if forecast_script.exists() and py.exists():
        try:
            subprocess.run([str(py), str(forecast_script)], cwd=ROOT, check=True, timeout=120)
            print("Forecast regenerated from empty dataset.")
        except subprocess.CalledProcessError:
            print("Forecast script failed — writing empty JSON outputs.")
            write_empty_json_outputs()
    else:
        write_empty_json_outputs()

    print("Done. Central database is empty and ready for upload testing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
