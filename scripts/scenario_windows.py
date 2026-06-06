"""Find wettest / driest 13-week windows with financial data + weather history."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

from unified_schema import read_unified

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "output"
PUBLIC = ROOT / "public" / "data"
INCOMING = ROOT / "data" / "incoming"

WEEKS = 13
RAIN_THRESHOLD_MM = 5.0
FROST_THRESHOLD_C = 0.0
MIN_ROWS_PER_WINDOW = 5


def _monday_on_or_before(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _monday_on_or_after(d: date) -> date:
    m = _monday_on_or_before(d)
    return m if m >= d else m + timedelta(days=7)


def _window_bounds(anchor_end: date) -> tuple[date, date, date]:
    start = anchor_end - timedelta(weeks=WEEKS - 1)
    start = _monday_on_or_before(start)
    end = start + timedelta(weeks=WEEKS) - timedelta(days=1)
    end_exclusive = start + timedelta(weeks=WEEKS)
    return start, end, end_exclusive


def _merge_daily_json(cities: dict[str, dict[str, dict]]) -> dict[str, dict[str, dict]]:
    """Blend operational weather_daily.json into the history cache."""
    for path in (OUT / "weather_daily.json", PUBLIC / "weather_daily.json"):
        if not path.exists():
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        for day in payload.get("days", []):
            city = day.get("city")
            iso = day.get("date")
            if not city or not iso:
                continue
            cities.setdefault(city, {})[iso] = {
                "date": iso,
                "rainfallMm": float(day.get("rainfallMm", 0)),
                "tempMinC": float(day.get("tempMinC", 5)),
                "isStoppage": bool(day.get("isStoppage")),
            }
        break
    return cities


def load_locations() -> list[dict]:
    path = INCOMING / "opco_locations.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def opco_city_map(locations: list[dict] | None = None) -> dict[str, str]:
    locations = locations or load_locations()
    mapping: dict[str, str] = {}
    for loc in locations:
        name = loc.get("opco_name") or loc.get("opco_id", "")
        city = loc.get("city")
        if name and city:
            mapping[name] = city
    return mapping


def city_coords(locations: list[dict] | None = None) -> dict[str, tuple[float, float]]:
    locations = locations or load_locations()
    out: dict[str, tuple[float, float]] = {}
    for loc in locations:
        city = loc.get("city")
        if city and city not in out:
            out[city] = (float(loc["lat"]), float(loc["lng"]))
    return out


def _history_path() -> Path:
    return OUT / "weather_history.json"


def _load_cached_history() -> dict[str, dict[str, dict]]:
    path = _history_path()
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    return raw.get("cities", {})


def _fetch_archive(lat: float, lng: float, start: date, end: date) -> list[dict]:
    params = urllib.parse.urlencode({
        "latitude": lat,
        "longitude": lng,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "daily": "precipitation_sum,temperature_2m_min",
        "timezone": "Europe/Amsterdam",
    })
    url = f"https://archive-api.open-meteo.com/v1/archive?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "AltisCashflow/1.0"})
    with urllib.request.urlopen(req, timeout=45) as resp:
        payload = json.loads(resp.read().decode())
    daily = payload.get("daily", {})
    times = daily.get("time", [])
    rain = daily.get("precipitation_sum", [])
    tmin = daily.get("temperature_2m_min", [])
    rows = []
    for i, t in enumerate(times):
        r = float(rain[i] if i < len(rain) and rain[i] is not None else 0)
        mn = float(tmin[i] if i < len(tmin) and tmin[i] is not None else 5)
        stoppage = r >= RAIN_THRESHOLD_MM or mn < FROST_THRESHOLD_C
        rows.append({
            "date": t,
            "rainfallMm": round(r, 1),
            "tempMinC": round(mn, 1),
            "isStoppage": stoppage,
        })
    return rows


def ensure_weather_history(data_min: date, data_max: date) -> dict[str, dict[str, dict]]:
    """Load or fetch daily weather per city for unified DB date span."""
    cached = _load_cached_history()
    coords = city_coords()
    updated = _merge_daily_json(dict(cached))
    if not coords:
        return updated

    today = date.today()
    pad_start = data_min - timedelta(days=14)
    pad_end = min(data_max + timedelta(days=14), today)
    if pad_end < pad_start:
        pad_end = pad_start
    changed = updated != cached

    for city, (lat, lng) in coords.items():
        city_days = updated.get(city, {})
        need_fetch = not city_days
        if city_days:
            dates = sorted(city_days.keys())
            if dates[0] > pad_start.isoformat() or dates[-1] < pad_end.isoformat():
                need_fetch = True
        if not need_fetch:
            continue
        try:
            rows = _fetch_archive(lat, lng, pad_start, pad_end)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, urllib.error.HTTPError) as exc:
            print(f"  Weather archive skipped for {city}: {exc}")
            continue
        bucket = dict(city_days)
        for row in rows:
            bucket[row["date"]] = row
        updated[city] = bucket
        changed = True
        print(f"  Cached {len(rows)} archive days for {city}")

    if changed:
        OUT.mkdir(parents=True, exist_ok=True)
        payload = {
            "start": pad_start.isoformat(),
            "end": pad_end.isoformat(),
            "cities": updated,
        }
        text = json.dumps(payload, indent=2)
        (_history_path()).write_text(text, encoding="utf-8")
        PUBLIC.mkdir(parents=True, exist_ok=True)
        (PUBLIC / "weather_history.json").write_text(text, encoding="utf-8")

    return updated


def _rows_in_window(rows: list[dict], start: date, end_exclusive: date, opco: str | None) -> list[dict]:
    filtered = []
    for row in rows:
        d = row["txn_date"]
        if d < start or d >= end_exclusive:
            continue
        if opco and opco != "all" and (row.get("opco") or "Unknown") != opco:
            continue
        filtered.append(row)
    return filtered


def candidate_anchor_ends(data_min: date, data_max: date) -> list[date]:
    """Every valid anchor end (Sunday) where a full 13-week window fits in data span."""
    first_start = _monday_on_or_after(data_min)
    last_end = data_max
    anchors: list[date] = []
    start = first_start
    while True:
        end = start + timedelta(weeks=WEEKS) - timedelta(days=1)
        if end > last_end:
            break
        anchors.append(end)
        start += timedelta(days=7)
    return anchors


def score_window(
    window_start: date,
    window_end: date,
    cities: list[str],
    weather: dict[str, dict[str, dict]],
) -> dict:
    stoppage_days = 0
    rain_mm = 0.0
    rain_days = 0
    cur = window_start
    while cur <= window_end:
        iso = cur.isoformat()
        for city in cities:
            day = weather.get(city, {}).get(iso)
            if not day:
                continue
            rain_mm += float(day.get("rainfallMm", 0))
            if day.get("isStoppage"):
                stoppage_days += 1
            if float(day.get("rainfallMm", 0)) >= RAIN_THRESHOLD_MM:
                rain_days += 1
        cur += timedelta(days=1)
    return {
        "stoppageDays": stoppage_days,
        "totalRainfallMm": round(rain_mm, 1),
        "rainDays": rain_days,
        "score": stoppage_days * 10 + rain_mm,
    }


def find_scenario_window(
    kind: str,
    opco: str | None = None,
    rows: list[dict] | None = None,
    weather: dict[str, dict[str, dict]] | None = None,
) -> dict:
    """Return best 13-week anchor for wet (max stoppage) or dry (min stoppage)."""
    rows = rows or []
    for row in rows:
        if "txn_date" not in row:
            row["txn_date"] = date.fromisoformat(str(row["date"])[:10])

    if not rows:
        today = date.today()
        start, end, _ = _window_bounds(today)
        return {
            "anchorEnd": end.isoformat(),
            "forecastStart": start.isoformat(),
            "forecastEnd": end.isoformat(),
            "rowsInWindow": 0,
            "stoppageDays": 0,
            "totalRainfallMm": 0,
            "rainDays": 0,
            "cities": [],
            "selectionReason": "No financial data loaded",
        }

    data_min = min(r["txn_date"] for r in rows)
    data_max = max(r["txn_date"] for r in rows)
    weather = weather if weather is not None else ensure_weather_history(data_min, data_max)

    city_map = opco_city_map()
    if opco and opco != "all":
        city = city_map.get(opco) or next(
            (r.get("city") for r in rows if r.get("opco") == opco and r.get("city")),
            None,
        )
        cities = [city] if city else []
    else:
        cities = []
        for o in sorted({r.get("opco") or "Unknown" for r in rows}):
            city = city_map.get(o) or next(
                (r.get("city") for r in rows if r.get("opco") == o and r.get("city")),
                None,
            )
            if city and city not in cities:
                cities.append(city)

    if not cities:
        cities = sorted({r.get("city") for r in rows if r.get("city")})

    best: dict | None = None
    for anchor_end in candidate_anchor_ends(data_min, data_max):
        window_start, window_end, window_end_exclusive = _window_bounds(anchor_end)
        in_window = _rows_in_window(rows, window_start, window_end_exclusive, opco)
        if len(in_window) < MIN_ROWS_PER_WINDOW:
            continue
        metrics = score_window(window_start, window_end, cities, weather)
        candidate = {
            "anchorEnd": anchor_end.isoformat(),
            "forecastStart": window_start.isoformat(),
            "forecastEnd": window_end.isoformat(),
            "rowsInWindow": len(in_window),
            "cities": cities,
            **metrics,
        }
        if best is None:
            best = candidate
            continue
        if kind == "wet":
            if candidate["score"] > best["score"]:
                best = candidate
            elif candidate["score"] == best["score"] and candidate["rowsInWindow"] > best["rowsInWindow"]:
                best = candidate
        else:
            if candidate["score"] < best["score"]:
                best = candidate
            elif candidate["score"] == best["score"] and candidate["rowsInWindow"] > best["rowsInWindow"]:
                best = candidate

    if best is None:
        anchor_end = data_max
        window_start, window_end, window_end_exclusive = _window_bounds(anchor_end)
        metrics = score_window(window_start, window_end, cities, weather)
        best = {
            "anchorEnd": anchor_end.isoformat(),
            "forecastStart": window_start.isoformat(),
            "forecastEnd": window_end.isoformat(),
            "rowsInWindow": len(_rows_in_window(rows, window_start, window_end_exclusive, opco)),
            "cities": cities,
            **metrics,
        }

    if kind == "wet":
        best["selectionReason"] = (
            f"Wettest 13-week period in your data — {best['stoppageDays']} stoppage days, "
            f"{best['totalRainfallMm']:.0f}mm rain across {', '.join(best['cities']) or 'portfolio sites'}"
        )
    else:
        best["selectionReason"] = (
            f"Driest 13-week period in your data — {best['stoppageDays']} stoppage days, "
            f"{best['totalRainfallMm']:.0f}mm rain across {', '.join(best['cities']) or 'portfolio sites'}"
        )
    return best


def build_scenario_index(rows: list[dict] | None = None) -> dict:
    """Precompute wet/dry window picks for all opcos + portfolio."""
    rows = rows or []
    for row in rows:
        if "txn_date" not in row:
            row["txn_date"] = date.fromisoformat(str(row["date"])[:10])
    if not rows:
        return {"wet": {"all": None}, "dry": {"all": None}}

    data_min = min(r["txn_date"] for r in rows)
    data_max = max(r["txn_date"] for r in rows)
    weather = ensure_weather_history(data_min, data_max)

    opcos = sorted({r.get("opco") or "Unknown" for r in rows})
    out: dict = {
        "wet": {"all": find_scenario_window("wet", "all", rows, weather)},
        "dry": {"all": find_scenario_window("dry", "all", rows, weather)},
    }
    for opco in opcos:
        out["wet"][opco] = find_scenario_window("wet", opco, rows, weather)
        out["dry"][opco] = find_scenario_window("dry", opco, rows, weather)
    return out
