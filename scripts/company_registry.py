"""Altis portfolio company registry — explicit opco/city, no row-level guessing."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INCOMING = ROOT / "data" / "incoming"
LOCATIONS_FILE = INCOMING / "opco_locations.json"

# Extra filename rules (checked against normalized filename)
FILENAME_RULES: list[tuple[tuple[str, ...], str]] = [
    (("altis dataset 2",), "OPCO-WINSCHOTEN"),
    (("altis dataset 1",), "OPCO-ANDIJK"),
    (("heeze", "portfolio company data"), "OPCO-HEEZE"),
    (("brunssum", "ummels", "portfolio company 2"), "OPCO-BRUNSSUM"),
    (("andijk",), "OPCO-ANDIJK"),
    (("winschoten",), "OPCO-WINSCHOTEN"),
]


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def load_companies() -> list[dict]:
    if not LOCATIONS_FILE.exists():
        return []
    return json.loads(LOCATIONS_FILE.read_text(encoding="utf-8"))


def company_by_id(opco_id: str) -> dict | None:
    for c in load_companies():
        if c.get("opco_id") == opco_id:
            return c
    return None


def match_company(filename: str) -> dict | None:
    """Match upload filename to a registered portfolio company."""
    norm_name = _norm(filename)
    companies = load_companies()
    by_id = {c["opco_id"]: c for c in companies}

    for tokens, opco_id in FILENAME_RULES:
        if all(_norm(t) in norm_name for t in tokens):
            company = by_id.get(opco_id)
            if company:
                return _match_payload(company, "filename_rules", filename)

    for company in companies:
        patterns = company.get("filename_patterns") or []
        folder = company.get("data_folder") or ""
        if folder:
            patterns = [*patterns, folder]
        for pattern in patterns:
            if pattern and _norm(pattern) in norm_name:
                return _match_payload(company, "filename_pattern", filename)
        city = company.get("city", "")
        if city and _norm(city) in norm_name:
            return _match_payload(company, "city_in_filename", filename)

    return None


def _match_payload(company: dict, method: str, filename: str) -> dict:
    city = company.get("city", "")
    opco_name = company.get("opco_name", "")
    return {
        "opcoId": company.get("opco_id"),
        "opcoName": opco_name,
        "city": city,
        "sourceSystem": company.get("source_system", "Unknown"),
        "projectId": f"PRJ-{city.upper().replace(' ', '')}-001" if city else "PRJ-UNK-001",
        "matchMethod": method,
        "matchedFile": filename,
        "dataFolder": company.get("data_folder"),
        "notes": company.get("notes"),
    }


def defaults_from_company(company: dict | None, user_defaults: dict | None = None) -> dict:
    """Build upload defaults — registry wins over empty user fields, never from CSV columns."""
    user = user_defaults or {}
    out = {
        "opco": user.get("opco", "").strip(),
        "city": user.get("city", "").strip(),
        "source_system": user.get("source_system", "").strip(),
        "project_id": user.get("project_id", "").strip(),
    }
    if company:
        if not out["opco"]:
            out["opco"] = company["opcoName"]
        if not out["city"]:
            out["city"] = company["city"]
        if not out["source_system"]:
            out["source_system"] = company["sourceSystem"]
        if not out["project_id"]:
            out["project_id"] = company["projectId"]
    if not out["project_id"] and out["city"]:
        out["project_id"] = f"PRJ-{out['city'].upper().replace(' ', '')}-001"
    return out


def save_companies(companies: list[dict]) -> None:
    """Persist registry and sync public copy for portfolio map."""
    LOCATIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    LOCATIONS_FILE.write_text(json.dumps(companies, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    public = ROOT / "public" / "data" / "opco_locations.json"
    public.parent.mkdir(parents=True, exist_ok=True)
    public.write_text(json.dumps(companies, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _slug_city(city: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", city.upper().replace(" ", "")) or "UNK"


def create_company(payload: dict) -> dict:
    """Add a portfolio company from onboarding form payload."""
    from ingest_profiles import build_ingest_profile

    city = (payload.get("city") or "").strip()
    opco_name = (payload.get("opcoName") or payload.get("opco_name") or "").strip()
    if not city or not opco_name:
        raise ValueError("City and operating company name are required")

    opco_id = (payload.get("opcoId") or payload.get("opco_id") or f"OPCO-{_slug_city(city)}").strip().upper()
    companies = load_companies()
    if any(c.get("opco_id") == opco_id for c in companies):
        raise ValueError(f"Company id {opco_id} already exists")

    patterns_raw = payload.get("filenamePatterns") or payload.get("filename_patterns") or []
    if isinstance(patterns_raw, str):
        patterns = [p.strip() for p in re.split(r"[\n,;]+", patterns_raw) if p.strip()]
    else:
        patterns = [str(p).strip() for p in patterns_raw if str(p).strip()]

    city_lower = city.lower()
    if city_lower not in patterns:
        patterns.insert(0, city_lower)
    folder = (payload.get("dataFolder") or payload.get("data_folder") or city_lower).strip()
    if folder and _norm(folder) not in (_norm(p) for p in patterns):
        patterns.append(folder)

    source_system = (payload.get("sourceSystem") or payload.get("source_system") or "Unknown").strip()
    parser_id = (payload.get("parser") or payload.get("parserId") or "generic").strip()

    profile_override = payload.get("ingestProfileOverride") or payload.get("ingest_profile_override")
    if profile_override:
        ingest_profile = profile_override
    else:
        ingest_profile = build_ingest_profile(
            parser_id,
            opco_name,
            city,
            source_system,
            format_name=payload.get("formatName") or payload.get("format_name"),
            target_store=payload.get("targetStore") or payload.get("target_store"),
            summary=payload.get("summary"),
        )

    entry = {
        "opco_id": opco_id,
        "opco_name": opco_name,
        "city": city,
        "region": (payload.get("region") or "").strip() or "Netherlands",
        "lat": float(payload.get("lat") or 52.1326),
        "lng": float(payload.get("lng") or 5.2913),
        "source_system": source_system,
        "data_folder": folder,
        "filename_patterns": patterns,
        "notes": (payload.get("notes") or "").strip()
        or f"{opco_name} — {source_system} export",
        "ingest_profile": ingest_profile,
    }

    companies.append(entry)
    save_companies(companies)

    try:
        from portfolio_stats import write_portfolio_stats
        write_portfolio_stats()
    except Exception:
        pass

    return _match_payload(entry, "onboarding", folder)


def list_companies_public() -> list[dict]:
    out = []
    for c in load_companies():
        profile = c.get("ingest_profile") or {}
        out.append({
            "opcoId": c.get("opco_id"),
            "opcoName": c.get("opco_name"),
            "city": c.get("city"),
            "sourceSystem": c.get("source_system"),
            "dataFolder": c.get("data_folder"),
            "filenamePatterns": c.get("filename_patterns", []),
            "notes": c.get("notes"),
            "ingestProfile": {
                "trained": profile.get("trained", False),
                "autoMerge": profile.get("auto_merge", False),
                "formatName": profile.get("format_name"),
                "parser": profile.get("parser"),
                "confidence": profile.get("confidence"),
                "summary": profile.get("summary"),
            } if profile else None,
        })
    return out
