#!/usr/bin/env python3
"""
Fetch real weather from Open-Meteo (past + forecast) per opco city.
No API key required. https://open-meteo.com
"""

from __future__ import annotations

import csv
import json
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "output"
PUBLIC = ROOT / "public" / "data"
INCOMING = ROOT / "data" / "incoming"

WEEKS = 13
RAIN_DAY_THRESHOLD_MM = 5.0
FROST_THRESHOLD_C = 0.0
TIMEZONE = "Europe/Amsterdam"


def week_start(d: date | None = None) -> date:
    d = d or date.today()
    return d - timedelta(days=d.weekday())


def forecast_window_start() -> date:
    """Align weather weeks with the 13-week forecast window from unified_data."""
    unified_path = OUT / "unified_data.csv"
    if unified_path.exists() and unified_path.stat().st_size > 50:
        dates: list[date] = []
        with unified_path.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                try:
                    dates.append(date.fromisoformat(str(row["date"])[:10]))
                except ValueError:
                    continue
        if dates:
            latest = max(dates)
            fs = latest - timedelta(weeks=WEEKS - 1)
            return fs - timedelta(days=fs.weekday())
    return week_start()


def load_locations() -> list[dict]:
    path = INCOMING / "opco_locations.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return []


def fetch_open_meteo(lat: float, lng: float, past_days: int = 84, forecast_days: int = 16) -> dict:
    params = urllib.parse.urlencode({
        "latitude": lat,
        "longitude": lng,
        "daily": "precipitation_sum,temperature_2m_min,temperature_2m_max,precipitation_hours",
        "timezone": TIMEZONE,
        "past_days": past_days,
        "forecast_days": forecast_days,
    })
    url = f"https://api.open-meteo.com/v1/forecast?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "AltisCashflow/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def parse_daily(payload: dict) -> list[dict]:
    daily = payload.get("daily", {})
    times = daily.get("time", [])
    rain = daily.get("precipitation_sum", [])
    tmin = daily.get("temperature_2m_min", [])
    tmax = daily.get("temperature_2m_max", [])
    hours = daily.get("precipitation_hours", [])

    rows = []
    for i, t in enumerate(times):
        d = date.fromisoformat(t)
        r = float(rain[i] if i < len(rain) and rain[i] is not None else 0)
        mn = float(tmin[i] if i < len(tmin) and tmin[i] is not None else 5)
        mx = float(tmax[i] if i < len(tmax) and tmax[i] is not None else 12)
        ph = float(hours[i] if i < len(hours) and hours[i] is not None else 0)
        stoppage = []
        if r >= RAIN_DAY_THRESHOLD_MM:
            stoppage.append("rain")
        if mn < FROST_THRESHOLD_C:
            stoppage.append("frost")
        rows.append({
            "date": d,
            "rainfall_mm": round(r, 1),
            "temp_min_c": round(mn, 1),
            "temp_max_c": round(mx, 1),
            "precip_hours": round(ph, 1),
            "stoppage": stoppage,
            "is_stoppage": len(stoppage) > 0,
        })
    return rows


def aggregate_weeks(daily: list[dict], start: date) -> list[dict]:
    by_week: dict[int, list[dict]] = defaultdict(list)
    end = start + timedelta(weeks=WEEKS)

    for day in daily:
        if day["date"] < start or day["date"] >= end:
            continue
        w = (day["date"] - start).days // 7 + 1
        if 1 <= w <= WEEKS:
            by_week[w].append(day)

    weeks = []
    for w in range(1, WEEKS + 1):
        days = by_week.get(w, [])
        if not days:
            weeks.append({
                "week": w,
                "label": f"W{w}",
                "weekStart": (start + timedelta(weeks=w - 1)).isoformat(),
                "rainfallMm": 0.0,
                "tempMinC": 3.0,
                "tempMaxC": 12.0,
                "rainDays": 0,
                "frostDays": 0,
                "stoppageDays": 0,
                "delayDays": 0,
                "source": "open-meteo",
            })
            continue

        rain_total = sum(d["rainfall_mm"] for d in days)
        rain_days = sum(1 for d in days if d["rainfall_mm"] >= RAIN_DAY_THRESHOLD_MM)
        frost_days = sum(1 for d in days if d["temp_min_c"] < FROST_THRESHOLD_C)
        stoppage_days = sum(1 for d in days if d["is_stoppage"])
        weeks.append({
            "week": w,
            "label": f"W{w}",
            "weekStart": days[0]["date"].isoformat() if days else (start + timedelta(weeks=w - 1)).isoformat(),
            "rainfallMm": round(rain_total, 1),
            "tempMinC": round(min(d["temp_min_c"] for d in days), 1),
            "tempMaxC": round(max(d["temp_max_c"] for d in days), 1),
            "rainDays": rain_days,
            "frostDays": frost_days,
            "stoppageDays": stoppage_days,
            "delayDays": stoppage_days,
            "source": "open-meteo",
        })
    return weeks


def highlight_for_week(week: dict, city: str) -> str | None:
    if week["stoppageDays"] >= 3:
        return f"{city} {week['label']}: {week['rainfallMm']:.0f}mm rain, {week['stoppageDays']} work stoppage days — milestone billing at risk"
    if week["frostDays"] >= 2:
        return f"{city} {week['label']}: frost on {week['frostDays']} days (min {week['tempMinC']:.0f}°C) — curing delays likely"
    if week["rainDays"] >= 2:
        return f"{city} {week['label']}: {week['rainDays']} heavy-rain days ({week['rainfallMm']:.0f}mm total)"
    return None


def match_transactions(city: str, daily: list[dict], unified_path: Path) -> list[dict]:
    """Link real transaction dates to weather on that day in this city."""
    if not unified_path.exists():
        return []

    daily_by_date = {d["date"]: d for d in daily}
    matches = []

    with unified_path.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("city") != city:
                continue
            try:
                txn_date = date.fromisoformat(row["date"])
            except ValueError:
                continue
            wx = daily_by_date.get(txn_date)
            if not wx or not wx["is_stoppage"]:
                continue
            amount = float(row["amount"])
            matches.append({
                "date": row["date"],
                "city": city,
                "opco": row.get("opco", ""),
                "amount": amount,
                "glAccount": row.get("gl_account", ""),
                "description": row.get("description", "")[:80],
                "rainfallMm": wx["rainfall_mm"],
                "tempMinC": wx["temp_min_c"],
                "stoppageReasons": wx["stoppage"],
                "insight": (
                    f"On {row['date']}, {city} had {wx['rainfall_mm']:.0f}mm rain"
                    + (f" and frost ({wx['temp_min_c']:.0f}°C)" if "frost" in wx["stoppage"] else "")
                    + f" while €{abs(amount):,.0f} {'billing' if amount > 0 else 'outflow'} recorded"
                ),
            })

    matches.sort(key=lambda m: abs(m["amount"]), reverse=True)
    return matches[:8]


def build_insights(locations: list[dict], city_data: dict[str, dict], start: date) -> dict:
    all_highlights = []
    cities_out = []

    for loc in locations:
        city = loc["city"]
        data = city_data[city]
        weeks = data["weeks"]
        highlights = [h for w in weeks if (h := highlight_for_week(w, city))]
        all_highlights.extend(highlights)

        worst = max(weeks, key=lambda w: w["stoppageDays"])
        cities_out.append({
            "city": city,
            "opco": loc["opco_name"],
            "lat": loc["lat"],
            "lng": loc["lng"],
            "weekly": weeks,
            "highlights": highlights,
            "worstWeek": worst["label"] if worst["stoppageDays"] > 0 else None,
            "totalStoppageDays": sum(w["stoppageDays"] for w in weeks),
            "transactionMatches": data["transaction_matches"],
        })

    return {
        "fetchedAt": datetime.now().isoformat(timespec="seconds"),
        "source": "Open-Meteo",
        "timezone": TIMEZONE,
        "horizonWeeks": WEEKS,
        "weekStart": start.isoformat(),
        "summary": (
            f"Real weather for {len(cities_out)} opco locations — "
            f"{sum(c['totalStoppageDays'] for c in cities_out)} total stoppage days in next 13 weeks "
            f"(from {start.isoformat()})"
        ),
        "topHighlights": all_highlights[:6],
        "cities": cities_out,
    }


def write_outputs(
    locations: list[dict],
    city_data: dict[str, dict],
    insights: dict,
    start: date,
) -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)

    csv_rows = []
    daily_rows = []
    for loc in locations:
        city = loc["city"]
        for w in city_data[city]["weeks"]:
            csv_rows.append([
                w["weekStart"], city, w["week"],
                w["rainfallMm"], w["tempMinC"], w["tempMaxC"],
                w["rainDays"], w["frostDays"], w["stoppageDays"], w["delayDays"],
                w["source"],
            ])
        for d in city_data[city]["daily"]:
            if start <= d["date"] < start + timedelta(weeks=WEEKS):
                daily_rows.append([
                    d["date"], city, d["rainfall_mm"], d["temp_min_c"], d["temp_max_c"],
                    "|".join(d["stoppage"]), d["is_stoppage"],
                ])

    headers = [
        "date", "city", "week", "rainfall_mm", "temp_min_c", "temp_max_c",
        "rain_days", "frost_days", "stoppage_days", "delay_days", "source",
    ]
    with (RAW / "weather.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(headers)
        w.writerows(csv_rows)

    with (RAW / "weather_daily.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["date", "city", "rainfall_mm", "temp_min_c", "temp_max_c", "stoppage", "is_stoppage"])
        w.writerows(daily_rows)

    daily_json = {
        "weekStart": start.isoformat(),
        "horizonWeeks": WEEKS,
        "days": [
            {
                "date": row[0].isoformat() if hasattr(row[0], "isoformat") else str(row[0]),
                "city": row[1],
                "rainfallMm": row[2],
                "tempMinC": row[3],
                "tempMaxC": row[4],
                "stoppageReasons": [s for s in str(row[5]).split("|") if s],
                "isStoppage": str(row[6]).lower() in ("true", "1"),
            }
            for row in daily_rows
        ],
    }

    for name, content in [
        ("weather_insights.json", json.dumps(insights, indent=2)),
        ("weather_daily.json", json.dumps(daily_json, indent=2)),
    ]:
        (OUT / name).write_text(content, encoding="utf-8")
        (PUBLIC / name).write_text(content, encoding="utf-8")


def fetch_all_weather(locations: list[dict] | None = None) -> dict:
    locations = locations or load_locations()
    if not locations:
        raise ValueError("No opco_locations.json found")

    start = week_start()
    unified_path = OUT / "unified_data.csv"
    city_data: dict[str, dict] = {}

    for loc in locations:
        city = loc["city"]
        print(f"  Fetching Open-Meteo for {city} ({loc['lat']}, {loc['lng']})…")
        try:
            payload = fetch_open_meteo(loc["lat"], loc["lng"])
        except urllib.error.URLError as e:
            print(f"  Warning: Open-Meteo failed for {city}: {e}")
            continue

        daily = parse_daily(payload)
        weeks = aggregate_weeks(daily, start)
        txn_matches = match_transactions(city, daily, unified_path)
        city_data[city] = {
            "weeks": weeks,
            "daily": daily,
            "transaction_matches": txn_matches,
        }

    if not city_data:
        raise RuntimeError("Could not fetch weather for any city")

    insights = build_insights(locations, city_data, start)
    write_outputs(locations, city_data, insights, start)
    print(f"Weather written: {len(city_data)} cities, {insights['summary']}")
    return insights


def main() -> None:
    print("Fetching real weather from Open-Meteo…")
    fetch_all_weather()


if __name__ == "__main__":
    main()
