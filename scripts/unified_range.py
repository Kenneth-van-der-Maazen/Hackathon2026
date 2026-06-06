"""Date-range summaries from the unified database."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import date
from pathlib import Path

from unified_schema import read_unified

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "output"
PUBLIC = ROOT / "public" / "data"


def _txn_date(row: dict) -> date | None:
    raw = row.get("date", "")
    if not raw:
        return None
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        return None


def _category(row: dict) -> str:
    cat = row.get("gl_category", "")
    if cat:
        return cat
    gl = str(row.get("gl_account", ""))
    if gl.startswith("8"):
        return "billing"
    if gl.startswith("4"):
        return "materials"
    if gl.startswith("5"):
        return "subcontractors"
    if gl.startswith("9"):
        return "overhead"
    return "unmapped"


def data_bounds() -> tuple[date | None, date | None, int]:
    rows = read_unified()
    dates = [d for r in rows if (d := _txn_date(r))]
    if not dates:
        return None, None, 0
    return min(dates), max(dates), len(rows)


def summarize_range(start: date, end: date) -> dict:
    if start > end:
        start, end = end, start

    totals = defaultdict(float)
    by_opco: dict[str, float] = defaultdict(float)
    row_count = 0

    for row in read_unified():
        txn = _txn_date(row)
        if txn is None or txn < start or txn > end:
            continue
        row_count += 1
        amount = float(row.get("amount") or 0)
        cat = _category(row)
        totals[cat] += amount
        if cat == "billing":
            by_opco[row.get("opco") or "Unknown"] += amount

    billing = totals.get("billing", 0.0)
    materials = totals.get("materials", 0.0)
    subcontractors = totals.get("subcontractors", 0.0)
    overhead = totals.get("overhead", 0.0)
    unmapped = totals.get("unmapped", 0.0)
    net = billing + materials + subcontractors + overhead + unmapped

    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "rowCount": row_count,
        "billing": round(billing),
        "materials": round(materials),
        "subcontractors": round(subcontractors),
        "overhead": round(overhead),
        "unmapped": round(unmapped),
        "net": round(net),
        "byOpco": {k: round(v) for k, v in sorted(by_opco.items(), key=lambda x: -x[1])},
    }


def build_daily_series() -> dict:
    """Aggregate unified rows by day for client-side date-range queries."""
    by_day: dict[str, dict] = {}
    all_opcos: set[str] = set()
    row_count = 0
    dates: list[date] = []

    for row in read_unified():
        txn = _txn_date(row)
        if txn is None:
            continue
        row_count += 1
        dates.append(txn)
        key = txn.isoformat()
        opco_name = row.get("opco") or "Unknown"
        all_opcos.add(opco_name)

        if key not in by_day:
            by_day[key] = {
                "date": key,
                "rowCount": 0,
                "billing": 0.0,
                "materials": 0.0,
                "subcontractors": 0.0,
                "overhead": 0.0,
                "unmapped": 0.0,
                "net": 0.0,
                "opcos": {},
            }

        amount = float(row.get("amount") or 0)
        cat = _category(row)
        day = by_day[key]
        day["rowCount"] = int(day["rowCount"]) + 1
        day[cat] = float(day[cat]) + amount
        day["net"] = float(day["net"]) + amount

        opco_bucket = day["opcos"].setdefault(
            opco_name,
            {
                "rowCount": 0,
                "billing": 0.0,
                "materials": 0.0,
                "subcontractors": 0.0,
                "overhead": 0.0,
                "unmapped": 0.0,
                "net": 0.0,
            },
        )
        opco_bucket["rowCount"] = int(opco_bucket["rowCount"]) + 1
        opco_bucket[cat] = float(opco_bucket[cat]) + amount
        opco_bucket["net"] = float(opco_bucket["net"]) + amount

    days = [by_day[k] for k in sorted(by_day)]
    for day in days:
        for field in ("billing", "materials", "subcontractors", "overhead", "unmapped", "net"):
            day[field] = round(float(day[field]))
        for opco_data in day["opcos"].values():
            for field in ("billing", "materials", "subcontractors", "overhead", "unmapped", "net"):
                opco_data[field] = round(float(opco_data[field]))

    data_min = min(dates).isoformat() if dates else None
    data_max = max(dates).isoformat() if dates else None

    return {
        "source": "unified_data.csv",
        "dataMinDate": data_min,
        "dataMaxDate": data_max,
        "totalRows": row_count,
        "opcos": sorted(all_opcos),
        "days": days,
    }


def write_unified_timeseries() -> dict:
    payload = build_daily_series()
    OUT.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, indent=2)
    (OUT / "unified_timeseries.json").write_text(text, encoding="utf-8")
    (PUBLIC / "unified_timeseries.json").write_text(text, encoding="utf-8")
    return payload
