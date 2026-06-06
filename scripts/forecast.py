#!/usr/bin/env python3
"""Five-driver 13-week forecast built from unified_data.csv (central database)."""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

from paths import data_path
from portfolio_stats import write_portfolio_stats
from scenario_windows import build_scenario_index
from unified_range import write_unified_timeseries

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "output"
PUBLIC = ROOT / "public" / "data"

START = date.today() - timedelta(days=date.today().weekday())
WEEKS = 13
MATERIALS_LAG_DAYS = 30
PAYMENT_LAG = {"small": 30, "large": 45}
LARGE_OPCO_BILLING_THRESHOLD = 1_000_000
RAIN_THRESHOLD = 5.0
FROST_THRESHOLD = 0.0


@dataclass
class TraceRecord:
    week: int
    driver: str
    amount: float
    scenario: str
    source_system: str
    gl_account: str
    project_id: str
    project_name: str
    assumption: str
    source_date: str = ""
    source_description: str = ""


def forecast_meta(
    forecast_start: date,
    latest: date,
    rows_in_window: int,
    total_rows: int,
    data_min: date,
    data_max: date,
) -> dict:
    last_day = forecast_start + timedelta(weeks=WEEKS) - timedelta(days=1)
    return {
        "weeks": WEEKS,
        "forecastStart": forecast_start.isoformat(),
        "forecastEnd": last_day.isoformat(),
        "anchoredTo": latest.isoformat(),
        "dataMinDate": data_min.isoformat(),
        "dataMaxDate": data_max.isoformat(),
        "rowsInWindow": rows_in_window,
        "totalRows": total_rows,
        "editable": True,
        "anchorNote": (
            "13-week forecast window. Pick any end date within your unified database "
            "to rebuild the forecast, or choose a range to view actual income."
        ),
    }


def load_unified(anchor_end: date | None = None) -> tuple[list[dict], date, date, int, date, date]:
    """Load rows from unified_data.csv; anchor 13-week window to anchor_end or latest txn."""
    raw: list[dict] = []
    with (OUT / "unified_data.csv").open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            row["amount"] = float(row["amount"])
            row["txn_date"] = date.fromisoformat(row["date"])
            raw.append(row)

    if not raw:
        return [], START, START, 0, START, START

    data_min = min(r["txn_date"] for r in raw)
    data_max = max(r["txn_date"] for r in raw)
    latest = anchor_end if anchor_end is not None else data_max
    if latest < data_min:
        latest = data_min
    if latest > data_max:
        latest = data_max
    forecast_start = latest - timedelta(weeks=WEEKS - 1)
    forecast_start = forecast_start - timedelta(days=forecast_start.weekday())

    rows: list[dict] = []
    window_end = forecast_start + timedelta(weeks=WEEKS)
    for row in raw:
        d = row["txn_date"]
        if d < forecast_start or d >= window_end:
            continue
        row["week"] = min(WEEKS, max(1, (d - forecast_start).days // 7 + 1))
        rows.append(row)

    return rows, forecast_start, latest, len(raw), data_min, data_max


def load_weather_by_city() -> dict[str, dict[int, float]]:
    by_city_week: dict[str, dict[int, list[float]]] = defaultdict(lambda: defaultdict(list))
    path = data_path("weather.csv")
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            city = row["city"]
            w = int(row["week"])
            if row.get("delay_days"):
                delay = float(row["delay_days"])
            elif row.get("stoppage_days"):
                delay = float(row["stoppage_days"])
            else:
                rain = float(row["rainfall_mm"])
                temp_min = float(row["temp_min_c"])
                delay = 0.0
                if rain > RAIN_THRESHOLD:
                    delay += 1
                if temp_min < FROST_THRESHOLD:
                    delay += 1
            by_city_week[city][w].append(delay)
    return {
        city: {w: sum(v) / len(v) for w, v in weeks.items()}
        for city, weeks in by_city_week.items()
    }


def load_weather() -> dict[int, float]:
    by_city = load_weather_by_city()
    by_week: dict[int, list[float]] = defaultdict(list)
    for city_delays in by_city.values():
        for w, d in city_delays.items():
            by_week[w].append(d)
    return {w: sum(v) / len(v) for w, v in by_week.items()}


def load_covenant() -> dict:
    return json.loads(data_path("covenant_terms.json").read_text(encoding="utf-8"))


def shift_week(week: int, delay_days: int) -> int:
    delay_weeks = delay_days // 5 + (1 if delay_days % 5 else 0)
    return min(WEEKS, max(1, week + delay_weeks))


def is_billing(row: dict) -> bool:
    return row.get("gl_category") == "billing" or str(row.get("gl_account", "")).startswith("8")


def is_materials(row: dict) -> bool:
    return row.get("gl_category") == "materials" or str(row.get("gl_account", "")).startswith("4")


def is_subcontractor(row: dict) -> bool:
    return row.get("gl_category") == "subcontractors" or str(row.get("gl_account", "")).startswith("5")


def delay_days(city: str, week: int, weather_by_city: dict, base_delay: dict, scenario: str) -> int:
    city_delay = weather_by_city.get(city, base_delay)
    base_val = city_delay.get(week, base_delay.get(week, 0))
    if scenario == "wet":
        return int(round(base_val * 2)) + (1 if week <= 6 else 0)
    if scenario == "dry":
        return max(0, int(round(base_val * 0.5)) - 1)
    return int(round(base_val))


def opco_segments(unified: list[dict]) -> dict[str, str]:
    billing_by_opco: dict[str, float] = defaultdict(float)
    for row in unified:
        if is_billing(row) and row["amount"] > 0:
            billing_by_opco[row["opco"]] += row["amount"]
    return {
        opco: "large" if total >= LARGE_OPCO_BILLING_THRESHOLD else "small"
        for opco, total in billing_by_opco.items()
    }


def annotate_week_dates(weeks: list[dict], forecast_start: date) -> None:
    for w in weeks:
        idx = int(w["week"]) - 1
        ws = forecast_start + timedelta(weeks=idx)
        we = ws + timedelta(days=6)
        w["weekStart"] = ws.isoformat()
        w["weekEnd"] = we.isoformat()
        w["chartLabel"] = ws.strftime("%b %d")


def empty_weeks(forecast_start: date | None = None) -> list[dict]:
    start = forecast_start or START
    weeks = [{
        "week": w,
        "label": f"W{w}",
        "materials": 0.0,
        "subcontractors": 0.0,
        "milestoneBilling": 0.0,
        "paymentLag": 0.0,
        "weatherImpact": 0.0,
        "net": 0.0,
    } for w in range(1, WEEKS + 1)]
    annotate_week_dates(weeks, start)
    return weeks


def build_materials(unified: list[dict], weeks: list[dict], traces: list[TraceRecord], scenario: str) -> None:
    for row in unified:
        if not is_materials(row):
            continue
        order_date = row["txn_date"]
        cash_date = order_date + timedelta(days=MATERIALS_LAG_DAYS)
        w = row["week"]  # already within forecast window
        if cash_date > order_date:
            w = min(WEEKS, max(1, w + MATERIALS_LAG_DAYS // 7))
        weeks[w - 1]["materials"] += row["amount"]
        traces.append(TraceRecord(
            week=w, driver="materials", amount=row["amount"], scenario=scenario,
            source_system=row["source_system"], gl_account=row["gl_account"],
            project_id=row["project_id"], project_name=row.get("description", row["opco"]),
            assumption=f"Unified DB row — net-{MATERIALS_LAG_DAYS}d materials lag",
            source_date=row["date"], source_description=row.get("description", ""),
        ))


def build_subcontractors(unified: list[dict], weeks: list[dict], traces: list[TraceRecord], scenario: str) -> None:
    for row in unified:
        if not is_subcontractor(row):
            continue
        w = row["week"]
        weeks[w - 1]["subcontractors"] += row["amount"]
        traces.append(TraceRecord(
            week=w, driver="subcontractors", amount=row["amount"], scenario=scenario,
            source_system=row["source_system"], gl_account=row["gl_account"],
            project_id=row["project_id"], project_name=row.get("description", row["opco"]),
            assumption="Unified DB subcontractor transaction",
            source_date=row["date"], source_description=row.get("description", ""),
        ))


def build_billing_and_weather(
    unified: list[dict],
    weather_by_city: dict[str, dict[int, float]],
    base_delay: dict[int, float],
    scenario: str,
    weeks: list[dict],
    traces: list[TraceRecord],
) -> None:
    for row in unified:
        if not is_billing(row) or row["amount"] <= 0:
            continue
        city = row.get("city") or "Heeze"
        base_week = row["week"]
        delay = delay_days(city, base_week, weather_by_city, base_delay, scenario)
        adjusted_week = shift_week(base_week, delay)
        amount = row["amount"]

        weeks[adjusted_week - 1]["milestoneBilling"] += amount
        traces.append(TraceRecord(
            week=adjusted_week, driver="milestoneBilling", amount=amount, scenario=scenario,
            source_system=row["source_system"], gl_account=row["gl_account"],
            project_id=row["project_id"], project_name=row.get("description", row["opco"]),
            assumption=f"Unified billing GL {row['gl_account']} — scheduled W{base_week}, cash W{adjusted_week}",
            source_date=row["date"], source_description=row.get("description", ""),
        ))

        if adjusted_week > base_week:
            gap = -amount
            weeks[base_week - 1]["weatherImpact"] += gap
            traces.append(TraceRecord(
                week=base_week, driver="weatherImpact", amount=gap, scenario=scenario,
                source_system="Weather", gl_account="—",
                project_id=row["project_id"], project_name=row.get("description", row["opco"]),
                assumption=f"Weather in {city}: billing shifted W{base_week}→W{adjusted_week} ({scenario})",
                source_date=row["date"], source_description=row.get("description", ""),
            ))


def build_payment_lag(
    unified: list[dict],
    segments: dict[str, str],
    weather_by_city: dict[str, dict[int, float]],
    base_delay: dict[int, float],
    scenario: str,
    weeks: list[dict],
    traces: list[TraceRecord],
) -> None:
    """Shift billed amounts to cash-collection weeks (timing only — net-neutral across 13 weeks)."""
    billing_by_week_opco: dict[tuple[int, str], float] = defaultdict(float)
    sample_row: dict[tuple[int, str], dict] = {}

    for row in unified:
        if not is_billing(row) or row["amount"] <= 0:
            continue
        city = row.get("city") or "Heeze"
        base_week = row["week"]
        delay = delay_days(city, base_week, weather_by_city, base_delay, scenario)
        billing_week = shift_week(base_week, delay)
        key = (billing_week, row["opco"])
        billing_by_week_opco[key] += row["amount"]
        sample_row[key] = row

    for (billing_week, opco), total in billing_by_week_opco.items():
        segment = segments.get(opco, "small")
        lag_days = PAYMENT_LAG[segment]
        cash_week = shift_week(billing_week, lag_days)
        if cash_week == billing_week:
            continue
        weeks[billing_week - 1]["milestoneBilling"] -= total
        weeks[cash_week - 1]["milestoneBilling"] += total
        weeks[billing_week - 1]["paymentLag"] -= total
        weeks[cash_week - 1]["paymentLag"] += total
        row = sample_row[(billing_week, opco)]
        traces.append(TraceRecord(
            week=cash_week, driver="paymentLag", amount=total, scenario=scenario,
            source_system=row["source_system"], gl_account=row["gl_account"],
            project_id=row["project_id"], project_name=row.get("description", opco),
            assumption=f"{lag_days}d collection lag — €{total:,.0f} moved W{billing_week}→W{cash_week}",
            source_date=row["date"], source_description=f"Unified DB · {opco}",
        ))


def finalize_net(weeks: list[dict]) -> None:
    for w in weeks:
        w["net"] = round(
            w["materials"] + w["subcontractors"] + w["milestoneBilling"] + w["paymentLag"] + w["weatherImpact"]
        )
        for k in ("materials", "subcontractors", "milestoneBilling", "paymentLag", "weatherImpact", "net"):
            w[k] = round(w[k])


def build_scenario(
    unified: list[dict],
    segments: dict[str, str],
    weather_by_city: dict[str, dict[int, float]],
    base_delay: dict[int, float],
    scenario: str,
    forecast_start: date,
) -> tuple[list[dict], list[TraceRecord]]:
    weeks = empty_weeks(forecast_start)
    traces: list[TraceRecord] = []
    build_materials(unified, weeks, traces, scenario)
    build_subcontractors(unified, weeks, traces, scenario)
    build_billing_and_weather(unified, weather_by_city, base_delay, scenario, weeks, traces)
    build_payment_lag(unified, segments, weather_by_city, base_delay, scenario, weeks, traces)
    finalize_net(weeks)
    return weeks, traces


def build_wip_from_unified(
    unified: list[dict],
    weather_by_city: dict[str, dict[int, float]],
    base_delay: dict[int, float],
) -> list[dict]:
    by_opco: dict[str, dict] = {}
    for row in unified:
        opco = row.get("opco") or "Unknown"
        city = row.get("city") or "Unknown"
        entry = by_opco.setdefault(opco, {
            "projectId": row.get("project_id", f"PRJ-{city[:4].upper()}-001"),
            "project": f"{city} — {opco}",
            "opco": opco,
            "city": city,
            "billingTotal": 0.0,
            "materialsTotal": 0.0,
            "subTotal": 0.0,
            "lastBillingWeek": 1,
            "sourceSystem": row.get("source_system", ""),
        })
        if is_billing(row) and row["amount"] > 0:
            entry["billingTotal"] += row["amount"]
            entry["lastBillingWeek"] = max(entry["lastBillingWeek"], row["week"])
        elif is_materials(row):
            entry["materialsTotal"] += abs(row["amount"])
        elif is_subcontractor(row):
            entry["subTotal"] += abs(row["amount"])

    result = []
    for opco, data in by_opco.items():
        city = data["city"]
        billing = data["billingTotal"]
        contract = max(400_000, round(billing * 1.25))
        pct = min(95.0, round((billing / contract) * 100, 1)) if contract else 0
        delay = delay_days(city, data["lastBillingWeek"], weather_by_city, base_delay, "base")
        status = "On Track"
        if delay >= 2:
            status = "At Risk"
        if delay >= 3:
            status = "Delayed"

        result.append({
            "projectId": data["projectId"],
            "project": data["project"],
            "opco": opco,
            "contractValue": contract,
            "wipToDate": round(billing),
            "pctComplete": pct,
            "nextMilestone": f"Billing week W{data['lastBillingWeek']}",
            "status": status,
            "weatherRisk": delay >= 1,
            "riskReason": (
                f"Weather in {city} may delay W{data['lastBillingWeek']} billing"
                if delay >= 1 else ""
            ),
            "materialsCommitted": round(data["materialsTotal"]),
            "subcontractorWeek": data["lastBillingWeek"],
            "actionNeeded": (
                f"Review schedule — {data['sourceSystem']} data shows €{billing:,.0f} billed"
                if status in ("At Risk", "Delayed") else ""
            ),
        })
    return sorted(result, key=lambda x: x["opco"])


def build_covenant_summary(forecast: dict, covenant: dict) -> dict:
    wet = forecast["wet"]
    base = forecast["base"]
    dry = forecast["dry"]
    headroom_by_scenario = {}
    for key in ("base", "wet", "dry"):
        weeks = forecast[key]
        cumulative = sum(w["net"] for w in weeks)
        projected_increase = max(0, -cumulative * 0.08)
        headroom = covenant["headroom_threshold_eur"] - projected_increase
        if key == "wet":
            headroom *= 0.85
        elif key == "dry":
            headroom *= 1.08
        headroom_by_scenario[key] = round(headroom)

    wet_early = sum(w["net"] for w in wet[:4])
    base_early = sum(w["net"] for w in base[:4])
    dry_early = sum(w["net"] for w in dry[:4])

    return {
        "headroomThresholdEur": covenant["headroom_threshold_eur"],
        "interestCoverageRatio": covenant["current_interest_coverage"],
        "interestCoverageMinimum": covenant["interest_coverage_minimum"],
        "headroomByScenario": headroom_by_scenario,
        "wetQuarterEarlyWeeksWorse": wet_early < base_early,
        "dryQuarterEarlyWeeksBetter": dry_early > base_early,
    }


def trace_to_dict(t: TraceRecord) -> dict:
    return {
        "week": t.week,
        "driver": t.driver,
        "amount": t.amount,
        "scenario": t.scenario,
        "sourceSystem": t.source_system,
        "glAccount": t.gl_account,
        "projectId": t.project_id,
        "projectName": t.project_name,
        "assumption": t.assumption,
        "sourceDate": t.source_date,
        "sourceDescription": t.source_description,
    }


def write_empty_outputs() -> None:
    """Clear forecast/trace/WIP/portfolio when unified DB has no rows."""
    covenant = load_covenant()
    empty_meta = forecast_meta(START, START, 0, 0, START, START)
    empty_meta["anchorNote"] = "No upload data yet — window will anchor to your latest transaction after ingest."
    empty_forecast = {
        "meta": empty_meta,
        "base": empty_weeks(),
        "wet": empty_weeks(),
        "dry": empty_weeks(),
    }
    covenant_summary = build_covenant_summary(empty_forecast, covenant)
    write_portfolio_stats([])
    write_unified_timeseries()

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

    OUT.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)

    (OUT / "forecast.json").write_text(json.dumps(empty_forecast, indent=2), encoding="utf-8")
    (OUT / "trace_data.json").write_text("[]\n", encoding="utf-8")
    (OUT / "wip_data.json").write_text("[]\n", encoding="utf-8")
    (OUT / "covenant_summary.json").write_text(json.dumps(covenant_summary, indent=2), encoding="utf-8")
    (OUT / "weather_insights.json").write_text(json.dumps(empty_weather, indent=2), encoding="utf-8")

    for name in (
        "forecast.json", "trace_data.json", "wip_data.json",
        "covenant_summary.json", "portfolio_stats.json", "weather_insights.json",
    ):
        src = OUT / name
        if src.exists():
            (PUBLIC / name).write_text(src.read_text(encoding="utf-8"), encoding="utf-8")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Build 13-week cash flow forecast from unified_data.csv")
    parser.add_argument(
        "--anchor-end",
        type=str,
        default=None,
        help="End date (YYYY-MM-DD) to anchor the 13-week forecast window",
    )
    args = parser.parse_args()
    anchor_end = date.fromisoformat(args.anchor_end) if args.anchor_end else None

    # Load raw rows once for scenario window indexing
    raw_rows: list[dict] = []
    with (OUT / "unified_data.csv").open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            row["amount"] = float(row["amount"])
            row["txn_date"] = date.fromisoformat(row["date"])
            raw_rows.append(row)

    if not raw_rows:
        print("No unified data — run data:pipeline or upload via Data Ingest first.")
        write_empty_outputs()
        return

    data_min = min(r["txn_date"] for r in raw_rows)
    data_max = max(r["txn_date"] for r in raw_rows)
    total_rows = len(raw_rows)
    scenario_index = build_scenario_index(raw_rows)

    weather_by_city = load_weather_by_city()
    base_delay = load_weather()
    covenant = load_covenant()

    forecast: dict[str, list] = {}
    scenario_meta: dict[str, dict] = {}
    all_traces: list[dict] = []

    for scenario in ("base", "wet", "dry"):
        if scenario == "base":
            scen_anchor = anchor_end
        else:
            pick = scenario_index[scenario]["all"]
            scen_anchor = date.fromisoformat(pick["anchorEnd"])

        unified, forecast_start, latest, _, _, _ = load_unified(scen_anchor)
        if not unified:
            continue

        segments = opco_segments(unified)
        weeks, traces = build_scenario(
            unified, segments, weather_by_city, base_delay, scenario, forecast_start,
        )
        forecast[scenario] = weeks
        all_traces.extend(trace_to_dict(t) for t in traces)

        meta = forecast_meta(forecast_start, latest, len(unified), total_rows, data_min, data_max)
        if scenario == "base":
            meta["anchorNote"] = (
                "13-week forecast window anchored to your latest transaction. "
                "Wet/Dry Quarter auto-select the wettest or driest 13-week period in your data."
            )
        else:
            pick = scenario_index[scenario]["all"]
            meta.update({
                "selectionReason": pick.get("selectionReason"),
                "stoppageDays": pick.get("stoppageDays"),
                "totalRainfallMm": pick.get("totalRainfallMm"),
                "rainDays": pick.get("rainDays"),
                "weatherCities": pick.get("cities"),
            })
        scenario_meta[scenario] = meta

        if scenario == "base":
            print(
                f"Forecast window ({scenario}): {forecast_start.isoformat()} – "
                f"{(forecast_start + timedelta(weeks=WEEKS) - timedelta(days=1)).isoformat()} "
                f"(anchored to {latest.isoformat()}), {len(unified):,} rows in window"
            )
        else:
            print(
                f"Forecast window ({scenario}): {forecast_start.isoformat()} – "
                f"{(forecast_start + timedelta(weeks=WEEKS) - timedelta(days=1)).isoformat()} "
                f"— {pick.get('selectionReason', '')[:80]}"
            )

    if not forecast.get("base"):
        print("No rows in base forecast window.")
        write_empty_outputs()
        return

    wip = build_wip_from_unified(
        load_unified(anchor_end)[0], weather_by_city, base_delay,
    )
    covenant_summary = build_covenant_summary(forecast, covenant)
    write_portfolio_stats()
    write_unified_timeseries()

    OUT.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)

    payload = {
        "meta": scenario_meta["base"],
        "scenarioMeta": scenario_meta,
        "scenarioWindows": scenario_index,
        "base": forecast["base"],
        "wet": forecast["wet"],
        "dry": forecast["dry"],
    }
    (OUT / "forecast.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    (OUT / "trace_data.json").write_text(json.dumps(all_traces, indent=2), encoding="utf-8")
    (OUT / "wip_data.json").write_text(json.dumps(wip, indent=2), encoding="utf-8")
    (OUT / "covenant_summary.json").write_text(json.dumps(covenant_summary, indent=2), encoding="utf-8")

    for name in (
        "forecast.json", "trace_data.json", "wip_data.json",
        "covenant_summary.json", "portfolio_stats.json",
    ):
        src = OUT / name
        if src.exists():
            (PUBLIC / name).write_text(src.read_text(encoding="utf-8"), encoding="utf-8")

    print(f"Forecast built from {len(unified):,} unified rows")
    print(f"  base net={sum(w['net'] for w in forecast['base']):,.0f} EUR")
    print(f"  WIP projects={len(wip)} opcos")


if __name__ == "__main__":
    main()
