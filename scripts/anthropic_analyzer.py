"""Anthropic Claude analysis for accounting file ingestion."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

PROMPT = """You are a senior controller AI for Altis Groep — a PE-backed Dutch roofing acquisition holding company.
Subcompanies (Heeze, Brunssum, Andijk, Winschoten, etc.) export data in DIFFERENT formats: Exact ledgers, Gilde, Yuki, invoice lists, multi-tab Excel with one tab per year.

Your job is a CONCRETE audit before merge — not generic guesses. Return JSON only (no markdown fences).

{
  "summary": "3-5 sentences: what this file is, which opco/subcompany, ALL years present, formats seen, redundancy/inconsistency risks",
  "data_type": "transactions|wip|pl|mixed|revenue|costs|overhead|unknown",
  "target_store": "revenue|costs|overhead|ledger|mixed",
  "store_reason": "One sentence why this belongs in that store",
  "detected_system": "Gilde|Yuki|Exact|Snelstart|Mixed|Unknown",
  "system_confidence": 0.0-1.0,
  "recommended_opco": "string or null",
  "recommended_city": "Dutch city if inferable or null",
  "date_range": {"start": "YYYY-MM-DD or null", "end": "YYYY-MM-DD or null"},
  "year_breakdown": {"2023": 0, "2024": 0},
  "row_count_estimate": number,
  "quality_checks": [
    "Concrete findings: e.g. '4 year tabs merged (2023-2026)', 'BTW column is VAT not amount', 'Duplicate invoice rows possible', 'Journal Dagboek used not GL code'"
  ],
  "inconsistencies": [
    "List format mismatches across sheets/subcompanies"
  ],
  "column_mapping": {
    "date": "exact header or null",
    "gl_account": "...",
    "amount": "...",
    "debit": "...",
    "credit": "...",
    "description": "...",
    "opco": "...",
    "project_id": "...",
    "city": "..."
  },
  "gl_suggestions": [
    {"gl_account": "8000", "category": "materials|subcontractors|billing|payment_lag|overhead|unmapped", "confidence": 0.9, "reason": "..."}
  ],
  "merge_recommendation": "ready|review_required|reject",
  "controller_question": "One clear question the user must confirm before merging"
}

Rules:
- If workbook profile shows mergedSheets, column_mapping MUST use the merged headers list (often lowercase: date, debit, credit, gl_account, description) — NOT raw Excel names like Datum/Debet unless they appear in merged headers.
- If workbook has multiple year tabs, mention EVERY year — never only the latest tab.
- Dagboek/journal is NOT a GL account — map debit/credit for amounts; BTW/Btw-bedrag is VAT not revenue.
- Verkoop/sales journals → billing GL 8xxx; infer from journal names when no GL column.
- Flag duplicate risk when same transactions may appear across tabs or formats.
- Use the machine-computed date_range and year_breakdown from workbook profile when provided — correct them if wrong.

GL categories: materials (4xxx), subcontractors (5xxx), billing (8xxx), overhead (9xxx), payment_lag, unmapped.
"""


def _build_prompt(
    filename: str,
    headers: list[str],
    sample_rows: list[dict[str, str]],
    sheet_name: str,
    workbook_profile: dict | None = None,
) -> str:
    parts = [
        PROMPT,
        f"\nFilename: {filename}",
        f"Primary sheet label: {sheet_name or 'n/a'}",
        f"Merged headers: {json.dumps(headers, ensure_ascii=False)}",
        "\nSample rows (first 8 of merged dataset):\n",
        json.dumps(sample_rows[:8], indent=2, ensure_ascii=False),
    ]
    if workbook_profile:
        parts.append("\n\nWorkbook profile (all tabs — use this for year/date audit):\n")
        parts.append(json.dumps(workbook_profile, indent=2, ensure_ascii=False))
    return "".join(parts)


def anthropic_available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def analyze_with_anthropic(
    filename: str,
    headers: list[str],
    sample_rows: list[dict[str, str]],
    sheet_name: str = "",
    workbook_profile: dict | None = None,
) -> dict[str, Any] | None:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None

    model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
    prompt = _build_prompt(filename, headers, sample_rows, sheet_name, workbook_profile)

    body = json.dumps({
        "model": model,
        "max_tokens": 4096,
        "messages": [
            {
                "role": "user",
                "content": prompt,
            }
        ],
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
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read().decode())
        text = ""
        for block in data.get("content", []):
            if block.get("type") == "text":
                text += block.get("text", "")
        text = text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        return json.loads(text)
    except (urllib.error.URLError, KeyError, json.JSONDecodeError, TimeoutError) as e:
        print(f"Anthropic analysis failed: {e}")
        return None


def to_enhancement(result: dict[str, Any]) -> dict[str, Any]:
    """Map Anthropic JSON to pipeline enhancement shape."""
    quality = list(result.get("quality_checks", []))
    for item in result.get("inconsistencies", []):
        if item and item not in quality:
            quality.append(f"Inconsistency: {item}")

    return {
        "detected_system": result.get("detected_system"),
        "system_confidence": result.get("system_confidence", 0.9),
        "column_mapping": result.get("column_mapping", {}),
        "gl_suggestions": result.get("gl_suggestions", []),
        "notes": result.get("summary", ""),
        "ai_briefing": {
            "summary": result.get("summary", ""),
            "dataType": result.get("data_type", "unknown"),
            "targetStore": result.get("target_store"),
            "storeReason": result.get("store_reason", ""),
            "recommendedOpco": result.get("recommended_opco"),
            "recommendedCity": result.get("recommended_city"),
            "dateRange": result.get("date_range"),
            "yearBreakdown": result.get("year_breakdown", {}),
            "qualityChecks": quality,
            "mergeRecommendation": result.get("merge_recommendation", "review_required"),
            "controllerQuestion": result.get("controller_question", ""),
        },
    }
