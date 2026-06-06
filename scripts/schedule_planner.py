#!/usr/bin/env python3
"""Crew schedule notifications + optional AI briefing (Field Schedule page)."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "output"
PUBLIC = ROOT / "public" / "data"
NOTIFY_FILE = OUT / "crew_notifications.json"


def _load_notifications() -> list[dict]:
    if NOTIFY_FILE.exists():
        return json.loads(NOTIFY_FILE.read_text(encoding="utf-8"))
    return []


def _save_notifications(items: list[dict]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(items, indent=2)
    NOTIFY_FILE.write_text(payload, encoding="utf-8")
    (PUBLIC / "crew_notifications.json").write_text(payload, encoding="utf-8")


def list_notifications(limit: int = 50) -> list[dict]:
    items = _load_notifications()
    return items[-limit:][::-1]


def add_notification(
    message: str,
    city: str,
    week_label: str,
    channel: str = "Altis Crew WhatsApp",
    author: str = "Field Schedule",
) -> dict:
    entry = {
        "id": str(uuid.uuid4())[:8],
        "sentAt": datetime.now(timezone.utc).isoformat(),
        "city": city,
        "weekLabel": week_label,
        "message": message.strip(),
        "channel": channel,
        "author": author,
    }
    items = _load_notifications()
    items.append(entry)
    _save_notifications(items)
    return entry


def ai_crew_briefing(
    sites: list[dict],
    weather_summary: str,
    daily_forecast: list[dict] | None = None,
    view_mode: str = "week",
    selected_date: str | None = None,
) -> str | None:
    """Optional Anthropic briefing for crew schedule."""
    import os
    import urllib.error
    import urllib.request

    from anthropic_analyzer import anthropic_available

    if not anthropic_available():
        return None

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
    daily_block = ""
    if daily_forecast:
        daily_block = f"\n\nDay-by-day forecast (Open-Meteo):\n{json.dumps(daily_forecast, indent=2)}\n"

    scope = f"Focus on {'the single day ' + selected_date if view_mode == 'day' and selected_date else 'the full week'}."
    prompt = f"""You are the Altis Groep field operations planner for Dutch roofing crews.

Weather summary: {weather_summary}
{scope}{daily_block}
Site plans (JSON):
{json.dumps(sites[:12], indent=2)}

Write a concise crew briefing for a WhatsApp group (max 220 words):
- Start with a day-by-day rain/dry outlook (which days rain at which cities)
- Which cities get outdoor work vs indoor/alternate tasks
- Specific practical guidance (membrane work, stand-down, admin)
- One line on cash-flow impact if billing may slip

Tone: direct, Dutch roofing site language, no markdown headers."""

    body = json.dumps({
        "model": model,
        "max_tokens": 400,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode())
        for block in data.get("content", []):
            if block.get("type") == "text":
                return block.get("text", "").strip()
    except (urllib.error.URLError, json.JSONDecodeError, KeyError):
        return None
    return None
