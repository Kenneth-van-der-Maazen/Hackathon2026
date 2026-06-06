"""Aggregate unified database rows into portfolio map / subsidiary stats."""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "output"
PUBLIC = ROOT / "public" / "data"
INCOMING = ROOT / "data" / "incoming"

MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

OPCO_COLORS = {
    "Heeze": "#9333ea",
    "Brunssum": "#d97706",
    "Andijk": "#16a34a",
    "Winschoten": "#2563eb",
}


def load_locations() -> list[dict]:
    path = INCOMING / "opco_locations.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return []


def load_unified_rows() -> list[dict]:
    path = OUT / "unified_data.csv"
    if not path.exists() or path.stat().st_size < 50:
        return []
    with path.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _month_key(date_str: str) -> str | None:
    try:
        d = datetime.fromisoformat(date_str[:10])
    except ValueError:
        return None
    return f"{MONTH_KEYS[d.month - 1]}-{str(d.year)[-2:]}"


def _year_key(date_str: str) -> str | None:
    try:
        return str(datetime.fromisoformat(date_str[:10]).year)
    except ValueError:
        return None


def _is_billing(row: dict) -> bool:
    cat = row.get("gl_category", "")
    gl = str(row.get("gl_account", ""))
    return cat == "billing" or gl.startswith("8")


def _is_cost(row: dict) -> bool:
    cat = row.get("gl_category", "")
    gl = str(row.get("gl_account", ""))
    return cat in ("materials", "subcontractors", "overhead") or gl.startswith(("4", "5", "9"))


def _data_quality(revenue_months: int, cost_months: int) -> str:
    if revenue_months >= 6 and cost_months >= 6:
        return "complete"
    if revenue_months > 0 and cost_months == 0:
        return "revenue-only"
    return "partial"


def build_portfolio_stats(unified: list[dict], locations: list[dict]) -> dict:
    if not unified:
        return {
            "source": "unified_data.csv",
            "totalRows": 0,
            "companies": [],
            "generatedAt": datetime.utcnow().isoformat() + "Z",
        }

    by_opco: dict[str, list[dict]] = defaultdict(list)
    for row in unified:
        key = row.get("opco") or row.get("city") or "Unknown"
        by_opco[key].append(row)

    companies = []
    for loc in locations:
        opco = loc["opco_name"]
        city = loc["city"]
        rows = by_opco.get(opco, by_opco.get(city, []))

        revenue: dict[str, float] = defaultdict(float)
        costs: dict[str, float] = defaultdict(float)
        annual: dict[str, float] = defaultdict(float)

        for row in rows:
            amount = abs(float(row.get("amount") or 0))
            mk = _month_key(row.get("date", ""))
            yk = _year_key(row.get("date", ""))
            if not mk or not yk:
                continue
            if _is_billing(row):
                revenue[mk] += amount
                annual[yk] += amount
            elif _is_cost(row):
                costs[mk] += amount

        rev_months = len(revenue)
        cost_months = len(costs)
        quality = _data_quality(rev_months, cost_months)

        companies.append({
            "id": loc.get("opco_id", city.lower()).replace("OPCO-", "").lower(),
            "name": opco,
            "city": city,
            "lat": loc["lat"],
            "lng": loc["lng"],
            "color": OPCO_COLORS.get(city, "#00e5c8"),
            "dataQuality": quality,
            "dataNote": f"From unified database — {len(rows):,} rows ({loc.get('source_system', 'mixed')})",
            "revenue": dict(revenue),
            "costs": dict(costs),
            "annualEstimates": {y: round(v) for y, v in annual.items()},
            "rowCount": len(rows),
        })

    return {
        "source": "unified_data.csv",
        "totalRows": len(unified),
        "companies": companies,
        "generatedAt": datetime.utcnow().isoformat() + "Z",
    }


def write_portfolio_stats(unified: list[dict] | None = None) -> dict:
    unified = unified if unified is not None else load_unified_rows()
    locations = load_locations()
    stats = build_portfolio_stats(unified, locations)
    OUT.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(stats, indent=2)
    (OUT / "portfolio_stats.json").write_text(payload, encoding="utf-8")
    (PUBLIC / "portfolio_stats.json").write_text(payload, encoding="utf-8")
    return stats
