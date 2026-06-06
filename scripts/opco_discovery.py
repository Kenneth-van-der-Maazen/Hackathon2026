"""AI-led operating company discovery — learn new formats from sample uploads."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from anthropic_analyzer import anthropic_available
from company_registry import load_companies
from ingest_profiles import PARSER_CATALOG, build_ingest_profile

DISCOVERY_PROMPT = """You are onboarding a NEW operating company into Altis Groep's cash-flow data platform.
Existing portfolio companies are listed below. The user uploaded a sample export that did NOT match any trained profile.

Propose a registry entry + ingest profile so future uploads of this format auto-match.

Return JSON only (no markdown):
{
  "opco_name": "Portfolio Company {City} or legal name",
  "city": "Dutch city",
  "region": "province or Netherlands",
  "source_system": "Gilde|Yuki|Exact|Snelstart|Mixed|Unknown",
  "filename_patterns": ["unique substrings from filename", "city lower case"],
  "data_folder": "short folder label",
  "format_name": "Human-readable format description",
  "target_store": "revenue|costs|overhead|ledger|mixed",
  "parser_recommendation": "generic|exact_multi_year|exact_gb_export|gilde_pl|yuki_fintransactions",
  "column_mapping": {
    "date": "header or null",
    "gl_account": "...",
    "debit": "...",
    "credit": "...",
    "description": "..."
  },
  "summary": "What this file contains and how to ingest it",
  "quality_checks": ["concrete audit points"],
  "notes": "Controller notes",
  "confidence": 0.0-1.0,
  "follow_up_questions": [],
  "is_new_opco": true
}

Rules:
- parser_recommendation: pick exact_multi_year ONLY if year tabs; gilde_pl ONLY for month columns; yuki ONLY for Grootboekrekening header; exact_gb_export ONLY for GB layout; else generic.
- filename_patterns must include city and distinctive parts of the uploaded filename.
- column_mapping MUST use headers from merged headers list provided.
- Do NOT duplicate an existing opco_id/city already in portfolio unless user explicitly says it's a new entity.
- follow_up_questions: only if city or opco_name truly unknown (max 2 short questions). Otherwise empty array.
"""


def needs_opco_discovery(analysis: dict) -> tuple[bool, str]:
    """True when upload should offer AI opco onboarding."""
    company = analysis.get("companyMatch")
    profile = analysis.get("ingestProfile") or {}

    if not company:
        return True, "unknown_file"

    if not profile.get("trained"):
        detected = (analysis.get("detectedSystem") or "").strip()
        expected = (company.get("sourceSystem") or "").strip()
        if detected and expected and detected not in (expected, "Unknown", "Mixed"):
            return True, "format_mismatch"

    briefing = analysis.get("aiBriefing") or {}
    if briefing.get("mergeRecommendation") == "reject" and not profile.get("trained"):
        return True, "unsupported_format"

    return False, ""


def _parse_file_for_discovery(content: bytes, filename: str, folder: Path) -> dict:
    from xlsx_reader import save_xlsx_as_csv, workbook_profile_dict
    from xlsx_reader import parse_workbook

    name = filename.lower()
    is_xlsx = name.endswith(".xlsx") or name.endswith(".xls")

    if is_xlsx:
        (folder / "sample.xlsx").write_bytes(content)
        try:
            parsed = parse_workbook(content)
            from xlsx_reader import rows_to_csv_bytes

            csv_bytes = rows_to_csv_bytes(parsed.headers, parsed.rows)
            (folder / "converted.csv").write_bytes(csv_bytes)
            workbook_profile = workbook_profile_dict(parsed)
            headers = parsed.headers
            rows = parsed.rows[:8]
            sheet_name = parsed.primary_sheet
        except Exception:
            headers, rows, sheet_name, workbook_profile = save_xlsx_as_csv(
                content, folder / "converted.csv"
            )
            from csv_analyzer import read_csv_content

            headers, rows = read_csv_content(
                (folder / "converted.csv").read_bytes(), max_rows=8
            )
    else:
        (folder / "original.csv").write_bytes(content)
        from csv_analyzer import read_csv_content

        headers, rows = read_csv_content(content, max_rows=8)
        sheet_name = None
        workbook_profile = None

    return {
        "headers": headers,
        "sample_rows": rows,
        "sheet_name": sheet_name,
        "workbook_profile": workbook_profile,
    }


def discover_with_ai(
    filename: str,
    headers: list[str],
    sample_rows: list[dict],
    sheet_name: str | None,
    workbook_profile: dict | None,
    user_answers: dict | None = None,
) -> dict[str, Any] | None:
    if not anthropic_available():
        return None

    existing = [
        {
            "opco_id": c.get("opco_id"),
            "city": c.get("city"),
            "source_system": c.get("source_system"),
            "format": (c.get("ingest_profile") or {}).get("format_name"),
        }
        for c in load_companies()
    ]

    parts = [
        DISCOVERY_PROMPT,
        f"\nUploaded filename: {filename}",
        f"\nExisting portfolio:\n{json.dumps(existing, indent=2)}",
    ]
    if user_answers:
        parts.append(f"\nUser answers:\n{json.dumps(user_answers, indent=2)}")
    parts.append(f"\nMerged headers: {json.dumps(headers)}")
    parts.append(f"\nSample rows:\n{json.dumps(sample_rows[:8], indent=2)}")
    if workbook_profile:
        parts.append(f"\nWorkbook profile:\n{json.dumps(workbook_profile, indent=2)}")

    model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
    body = json.dumps({
        "model": model,
        "max_tokens": 4096,
        "messages": [{"role": "user", "content": "".join(parts)}],
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "x-api-key": os.environ["ANTHROPIC_API_KEY"],
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
        print(f"Opco discovery AI failed: {e}")
        return None


def heuristic_discovery(
    filename: str,
    headers: list[str],
    user_answers: dict | None,
) -> dict[str, Any]:
    """Fallback when AI unavailable."""
    answers = user_answers or {}
    city = (answers.get("city") or "").strip()
    opco_name = (answers.get("opcoName") or answers.get("opco_name") or "").strip()
    if not city:
        city = "New Opco"
    if not opco_name:
        opco_name = f"Portfolio Company {city}"

    stem = Path(filename).stem.lower()
    patterns = list({city.lower(), stem[:40]})
    return {
        "opco_name": opco_name,
        "city": city,
        "region": answers.get("region") or "Netherlands",
        "source_system": answers.get("sourceSystem") or "Unknown",
        "filename_patterns": patterns,
        "data_folder": stem[:30] or city.lower(),
        "format_name": f"Export from {filename}",
        "target_store": "mixed",
        "parser_recommendation": "generic",
        "column_mapping": {},
        "summary": f"Sample file {filename} — configure column mapping on first merge.",
        "quality_checks": ["AI unavailable — manual review required"],
        "notes": answers.get("notes") or "",
        "confidence": 0.5,
        "follow_up_questions": [],
        "is_new_opco": True,
    }


def proposal_to_create_payload(proposal: dict, upload_id: str | None = None) -> dict:
    parser_id = proposal.get("parser_recommendation") or "generic"
    if parser_id not in PARSER_CATALOG and parser_id not in ("generic",):
        parser_id = "generic"

    patterns = proposal.get("filename_patterns") or []
    if isinstance(patterns, str):
        patterns = [p.strip() for p in re.split(r"[\n,;]+", patterns) if p.strip()]

    profile = build_ingest_profile(
        parser_id,
        proposal.get("opco_name", ""),
        proposal.get("city", ""),
        proposal.get("source_system", "Unknown"),
        format_name=proposal.get("format_name"),
        target_store=proposal.get("target_store"),
        summary=proposal.get("summary"),
    )

    ai_mapping = proposal.get("column_mapping") or {}
    if ai_mapping:
        profile["column_mapping"] = {
            k: v for k, v in ai_mapping.items() if v
        }
    if proposal.get("quality_checks"):
        profile["quality_checks"] = proposal["quality_checks"]
    profile["confidence"] = proposal.get("confidence", 0.85)
    profile["learned_from_upload"] = upload_id
    profile["auto_merge"] = False

    return {
        "opcoName": proposal.get("opco_name"),
        "city": proposal.get("city"),
        "region": proposal.get("region"),
        "sourceSystem": proposal.get("source_system"),
        "filenamePatterns": patterns,
        "dataFolder": proposal.get("data_folder"),
        "notes": proposal.get("notes"),
        "parser": parser_id,
        "targetStore": proposal.get("target_store"),
        "summary": proposal.get("summary"),
        "ingestProfileOverride": profile,
    }


def run_discovery(
    content: bytes,
    filename: str,
    folder: Path,
    user_answers: dict | None = None,
    upload_id: str | None = None,
) -> dict:
    parsed = _parse_file_for_discovery(content, filename, folder)
    ai = discover_with_ai(
        filename,
        parsed["headers"],
        parsed["sample_rows"],
        parsed.get("sheet_name"),
        parsed.get("workbook_profile"),
        user_answers,
    )
    proposal = ai or heuristic_discovery(filename, parsed["headers"], user_answers)

    questions = proposal.get("follow_up_questions") or []
    if questions and not user_answers:
        return {
            "status": "questions",
            "questions": questions,
            "sessionId": upload_id or folder.name,
            "filename": filename,
            "preview": {
                "detectedSystem": proposal.get("source_system"),
                "headers": parsed["headers"][:12],
                "rowCountHint": len(parsed["sample_rows"]),
            },
        }

    create_payload = proposal_to_create_payload(proposal, upload_id)
    return {
        "status": "proposal",
        "sessionId": upload_id or folder.name,
        "filename": filename,
        "proposal": {
            "opcoName": proposal.get("opco_name"),
            "city": proposal.get("city"),
            "region": proposal.get("region"),
            "sourceSystem": proposal.get("source_system"),
            "filenamePatterns": create_payload["filenamePatterns"],
            "formatName": proposal.get("format_name"),
            "targetStore": proposal.get("target_store"),
            "parser": create_payload["parser"],
            "summary": proposal.get("summary"),
            "qualityChecks": proposal.get("quality_checks", []),
            "columnMapping": proposal.get("column_mapping", {}),
            "confidence": proposal.get("confidence", 0.85),
            "notes": proposal.get("notes"),
        },
        "createPayload": create_payload,
        "aiUsed": ai is not None,
    }
