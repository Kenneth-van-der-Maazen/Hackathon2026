#!/usr/bin/env python3
"""FastAPI server: upload CSV/XLSX → Anthropic analysis → unified dataset."""

from __future__ import annotations

import csv
import json
import subprocess
import uuid
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from anthropic_analyzer import analyze_with_anthropic, anthropic_available, to_enhancement
from csv_analyzer import ColumnMapping, analyze_csv, normalize_all_rows, read_all_csv_rows, read_csv_content
from load_env import load_env
from unified_schema import (
    UPLOADS,
    load_gl_mapping_file,
    merge_rows_routed,
    save_upload_meta,
    store_stats,
    write_stores_and_master,
)
from xlsx_reader import save_xlsx_as_csv

load_env()

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public" / "data"

app = FastAPI(title="Altis Data Ingest API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _upload_dir(upload_id: str) -> Path:
    return UPLOADS / upload_id


def _load_analysis(upload_id: str) -> dict:
    path = _upload_dir(upload_id) / "analysis.json"
    if not path.exists():
        raise HTTPException(404, "Upload not found")
    return json.loads(path.read_text(encoding="utf-8"))


def _read_upload_rows(upload_id: str, analysis: dict) -> tuple[list[str], list[dict[str, str]]]:
    folder = _upload_dir(upload_id)
    file_type = analysis.get("fileType", "csv")
    if file_type == "xlsx":
        csv_path = folder / "converted.csv"
    else:
        csv_path = folder / "original.csv"
    if not csv_path.exists():
        raise HTTPException(404, "Original file missing")
    return read_all_csv_rows(csv_path)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "aiAvailable": anthropic_available(),
        "aiProvider": "anthropic" if anthropic_available() else "none",
    }


@app.get("/api/uploads")
def list_uploads():
    if not UPLOADS.exists():
        return {"uploads": []}
    items = []
    for folder in sorted(UPLOADS.iterdir(), reverse=True):
        if not folder.is_dir():
            continue
        analysis_path = folder / "analysis.json"
        if analysis_path.exists():
            data = json.loads(analysis_path.read_text(encoding="utf-8"))
            items.append({
                "uploadId": data.get("uploadId"),
                "filename": data.get("filename"),
                "rowCount": data.get("rowCount"),
                "detectedSystem": data.get("detectedSystem"),
                "status": data.get("status", "pending"),
                "aiUsed": data.get("aiUsed", False),
            })
    return {"uploads": items}


from xlsx_reader import rows_to_csv_bytes, save_xlsx_as_csv


def _run_analyze_pipeline(
    upload_id: str,
    filename: str,
    content: bytes,
    folder: Path,
    user_defaults: dict,
    use_ai: bool = True,
) -> dict:
    """Shared analyze: trained profile first, optional AI fallback."""
    from company_registry import company_by_id, defaults_from_company, match_company
    from ingest_profiles import (
        get_ingest_profile,
        parse_with_profile,
        profile_to_enhancement,
    )

    name = filename.lower()
    is_csv = name.endswith(".csv") or name.endswith(".txt")
    is_xlsx = name.endswith(".xlsx") or name.endswith(".xls")
    file_type = "xlsx" if is_xlsx else "csv"
    sheet_name = None
    workbook_profile = None
    csv_bytes = content
    ingest_profile = None
    parser_used = None

    company_match = match_company(filename or "")
    defaults = defaults_from_company(company_match, user_defaults)

    if company_match:
        ingest_profile = get_ingest_profile(company_match["opcoId"])

    if is_xlsx:
        (folder / "original.xlsx").write_bytes(content)
        parsed = None
        if ingest_profile and ingest_profile.get("trained") and company_match:
            parsed = parse_with_profile(content, filename, company_match)
        if parsed and parsed.rows:
            parser_used = parsed.parser
            sheet_name = parsed.sheet_label
            workbook_profile = parsed.workbook_profile
            csv_bytes = rows_to_csv_bytes(parsed.headers, parsed.rows)
            (folder / "converted.csv").write_bytes(csv_bytes)
        else:
            headers, rows, sheet_name, workbook_profile = save_xlsx_as_csv(
                content, folder / "converted.csv"
            )
            csv_bytes = (folder / "converted.csv").read_bytes()
    else:
        (folder / "original.csv").write_bytes(content)

    ai_enhancement = None
    if ingest_profile and company_match and (
        ingest_profile.get("trained") or ingest_profile.get("column_mapping")
    ):
        company = company_by_id(company_match["opcoId"]) or {}
        ai_enhancement = profile_to_enhancement(ingest_profile, company)
    elif use_ai and anthropic_available():
        headers, samples = read_csv_content(csv_bytes, max_rows=8)
        raw = analyze_with_anthropic(
            filename, headers, samples, sheet_name or "", workbook_profile
        )
        if raw:
            ai_enhancement = to_enhancement(raw)

    result = analyze_csv(
        upload_id,
        filename,
        csv_bytes,
        defaults,
        ai_enhancement,
        file_type=file_type,
        sheet_name=sheet_name,
        workbook_profile=workbook_profile,
    )
    data = result.to_dict()
    data["status"] = "pending"
    data["companyMatch"] = company_match
    data["ingestProfile"] = {
        "trained": ingest_profile.get("trained") if ingest_profile else False,
        "autoMerge": ingest_profile.get("auto_merge") if ingest_profile else False,
        "formatName": ingest_profile.get("format_name") if ingest_profile else None,
        "parser": parser_used or (ingest_profile.get("parser") if ingest_profile else None),
        "confidence": ingest_profile.get("confidence") if ingest_profile else None,
    } if ingest_profile else None
    if company_match:
        data["suggestedContext"] = {
            "opco": company_match["opcoName"],
            "city": company_match["city"],
            "sourceSystem": company_match["sourceSystem"],
        }
    if ai_enhancement and ai_enhancement.get("notes"):
        data["aiNotes"] = ai_enhancement["notes"]
    data["resolvedDefaults"] = defaults
    profile = get_ingest_profile(company_match["opcoId"]) if company_match else None
    return _enrich_scan_results(data, profile)


def _enrich_scan_results(data: dict, profile: dict | None) -> dict:
    """Augment analysis with thorough scan metrics and confidence scores."""
    mapping = data.get("columnMapping") or {}
    col_conf = dict(data.get("columnConfidence") or {})
    profile_conf = (profile or {}).get("confidence", 1.0) if profile and profile.get("trained") else None

    if profile_conf is not None and profile:
        for field, col in (profile.get("column_mapping") or {}).items():
            if col and mapping.get(field):
                col_conf[field] = profile_conf
        # Drop stale confidence scores for fields no longer mapped
        for field in list(col_conf.keys()):
            if not mapping.get(field):
                col_conf.pop(field, None)
        data["columnConfidence"] = col_conf

    dup = data.get("duplicateCheck") or {}
    dataset = data.get("datasetProfile") or {}
    row_count = data.get("rowCount", 0)
    valid_rows = dup.get("newRows", 0) + dup.get("duplicateRows", 0)
    if valid_rows == 0 and row_count > 0:
        valid_rows = row_count

    has_amount = bool(mapping.get("amount") or (mapping.get("debit") and mapping.get("credit")))
    mapping_ok = bool(mapping.get("date") and has_amount)

    warnings = data.get("warnings") or []
    blockers = [w for w in warnings if "Could not detect" in w or "Select a portfolio company" in w]
    overall = profile_conf if profile_conf is not None else data.get("systemConfidence", 0.5)
    if blockers:
        overall = min(overall, 0.4)
    elif warnings:
        overall = min(overall, 0.85)
    if dup.get("blockMerge"):
        overall = min(overall, 0.2)

    checks: list[str] = []
    briefing = dict(data.get("aiBriefing") or {})
    if briefing.get("qualityChecks"):
        checks.extend(briefing["qualityChecks"])

    if profile and profile.get("trained"):
        checks.insert(0, f"Matched trained format: {profile.get('format_name', profile.get('parser'))}")
    checks.append(f"Scanned {row_count:,} source rows → {valid_rows:,} map to unified schema")
    if dataset.get("dateRange", {}).get("start"):
        dr = dataset["dateRange"]
        checks.append(f"Date span verified: {dr['start']} → {dr['end']}")
    if dataset.get("yearBreakdown"):
        years = " · ".join(f"{y} ({n:,})" for y, n in sorted(dataset["yearBreakdown"].items()))
        checks.append(f"Year coverage: {years}")
    if dup.get("status") == "all_new":
        checks.append("Duplicate check: all rows are new")
    elif dup.get("duplicateRows", 0) > 0:
        checks.append(
            f"Duplicate check: {dup['duplicateRows']:,} existing · {dup['newRows']:,} new rows"
        )
    if mapping_ok:
        checks.append("Column mapping verified against file headers")
    else:
        checks.append("Column mapping incomplete — review required before merge")

    briefing["qualityChecks"] = checks
    briefing["yearBreakdown"] = dataset.get("yearBreakdown") or briefing.get("yearBreakdown")
    if dataset.get("dateRange"):
        briefing["dateRange"] = dataset["dateRange"]

    if dup.get("blockMerge"):
        briefing["mergeRecommendation"] = "reject"
    elif blockers or not mapping_ok:
        briefing["mergeRecommendation"] = "review_required"
    else:
        briefing["mergeRecommendation"] = "ready"

    data["aiBriefing"] = briefing
    data["scanSummary"] = {
        "overallConfidence": round(overall, 2),
        "rowsScanned": row_count,
        "rowsValid": valid_rows,
        "mappingVerified": mapping_ok,
        "duplicateStatus": dup.get("status"),
        "trainedProfile": bool(profile and profile.get("trained")),
    }
    if data.get("ingestProfile") is not None:
        data["ingestProfile"]["confidence"] = round(overall, 2)
    data["systemConfidence"] = round(
        profile_conf if profile_conf is not None else data.get("systemConfidence", 0.5), 2
    )
    from opco_discovery import needs_opco_discovery

    discover, discover_reason = needs_opco_discovery(data)
    data["needsDiscovery"] = discover
    data["discoveryReason"] = discover_reason
    return data


def _python_bin() -> Path | None:
    py = ROOT / ".venv" / "bin" / "python"
    return py if py.exists() else None


def _run_forecast() -> tuple[bool, str | None]:
    py = _python_bin()
    forecast_script = ROOT / "scripts" / "forecast.py"
    if not py or not forecast_script.exists():
        return False, "Forecast script not available"
    try:
        subprocess.run(
            [str(py), str(forecast_script)],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
            timeout=120,
        )
        return True, None
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "Forecast failed").strip()
        return False, detail
    except Exception as exc:
        return False, str(exc)


def _run_weather() -> tuple[bool, str | None]:
    try:
        from fetch_weather import fetch_all_weather, load_locations

        if not load_locations():
            return False, "No opco locations configured"
        fetch_all_weather()
        return True, None
    except Exception as exc:
        return False, str(exc)


def _run_confirm_pipeline(upload_id: str, analysis: dict, body: dict) -> dict:
    """Merge analyzed upload into central database."""
    from ingest_profiles import auto_gl_approvals, get_ingest_profile

    column_mapping = ColumnMapping.from_dict(
        body.get("columnMapping", analysis.get("columnMapping", {}))
    )
    meta_path = _upload_dir(upload_id) / "meta.json"
    defaults = json.loads(meta_path.read_text()).get("defaults", {}) if meta_path.exists() else {}

    if body.get("opco"):
        defaults["opco"] = body["opco"]
    if body.get("city"):
        defaults["city"] = body["city"]
    if body.get("sourceSystem"):
        defaults["source_system"] = body["sourceSystem"]

    _, raw_rows = _read_upload_rows(upload_id, analysis)
    normalized, warnings = normalize_all_rows(raw_rows, column_mapping, defaults)

    if not normalized:
        raise HTTPException(400, "No valid rows after mapping — check column mapping")

    gl_map = load_gl_mapping_file()
    approved = dict(body.get("glApprovals", {}))
    profile = None
    if analysis.get("companyMatch", {}).get("opcoId"):
        profile = get_ingest_profile(analysis["companyMatch"]["opcoId"])
    if profile:
        approved.update(auto_gl_approvals(analysis.get("glSuggestions", []), profile))

    for gl, cat in approved.items():
        if cat and cat != "unmapped":
            gl_map[gl] = cat

    for sug in body.get("glSuggestions", analysis.get("glSuggestions", [])):
        if sug.get("status") == "approved" and sug.get("suggestedCategory") != "unmapped":
            gl_map[sug["glAccount"]] = sug["suggestedCategory"]

    merged_by_store, added_by_store, added = merge_rows_routed(
        normalized,
        gl_map,
        analysis.get("storeRouting")
        or analysis.get("duplicateCheck", {}).get("storeRouting")
        or body.get("storeRouting")
        or {},
    )

    if added == 0:
        raise HTTPException(
            409,
            "No new rows to merge — this file is already in the central database.",
        )

    routing = analysis.get("storeRouting") or analysis.get("duplicateCheck", {}).get("storeRouting") or {}
    store_parts = [f"{added_by_store[sid]} → {sid}" for sid in added_by_store if added_by_store[sid]]
    notes = [
        f"Last upload: {analysis.get('filename')} ({added} new rows)",
        f"Routed: {', '.join(store_parts) if store_parts else routing.get('targetStore', 'mixed')}",
        f"Source system: {defaults.get('source_system') or analysis.get('detectedSystem')}",
        f"Opco: {defaults.get('opco', '—')}",
    ]
    if analysis.get("aiBriefing", {}).get("summary"):
        notes.append(f"Profile: {analysis['aiBriefing']['summary'][:200]}")
    if warnings:
        notes.append("Warnings: " + "; ".join(warnings))

    all_rows = write_stores_and_master(merged_by_store, gl_map, notes)

    raw_gl = ROOT / "data" / "raw" / "gl_account_mapping.csv"
    raw_gl.parent.mkdir(parents=True, exist_ok=True)
    with raw_gl.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["gl_account", "category", "description"])
        for gl, cat in sorted(gl_map.items()):
            w.writerow([gl, cat, "Approved via upload review"])

    analysis["status"] = "confirmed"
    analysis["rowsAdded"] = added
    analysis["rowsAddedByStore"] = added_by_store
    analysis["totalRows"] = len(all_rows)
    analysis["confirmWarnings"] = warnings
    (_upload_dir(upload_id) / "analysis.json").write_text(
        json.dumps(analysis, indent=2), encoding="utf-8"
    )

    forecast_ran, forecast_error = _run_forecast()
    weather_ran, weather_error = _run_weather()

    return {
        "ok": True,
        "rowsAdded": added,
        "rowsAddedByStore": added_by_store,
        "duplicateRowsSkipped": len(normalized) - added,
        "totalRows": len(all_rows),
        "storeRouting": routing,
        "forecastRan": forecast_ran,
        "forecastError": forecast_error,
        "weatherRan": weather_ran,
        "weatherError": weather_error,
        "warnings": warnings,
    }


@app.get("/api/companies")
def list_companies():
    from company_registry import list_companies_public

    return {"companies": list_companies_public()}


@app.get("/api/companies/parsers")
def list_parsers():
    from ingest_profiles import list_parsers_public

    return {"parsers": list_parsers_public()}


@app.post("/api/companies")
async def create_company_endpoint(body: dict):
    from company_registry import create_company

    try:
        company = create_company(body)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    from company_registry import list_companies_public

    return {"ok": True, "company": company, "companies": list_companies_public()}


@app.post("/api/companies/discover")
async def discover_company(
    file: Optional[UploadFile] = File(None),
    answers: str = Form("{}"),
    upload_id: str = Form(""),
):
    """AI analyzes unknown-format sample file and proposes new opco registry entry."""
    import json as json_mod

    from opco_discovery import run_discovery

    content: bytes | None = None
    filename = ""

    if upload_id:
        folder = _upload_dir(upload_id.strip())
        for name in ("original.xlsx", "original.csv"):
            path = folder / name
            if path.exists():
                content = path.read_bytes()
                meta = folder / "meta.json"
                if meta.exists():
                    filename = json_mod.loads(meta.read_text()).get("filename", name)
                else:
                    filename = name
                break
        if not content:
            analysis_path = folder / "analysis.json"
            if analysis_path.exists():
                filename = json_mod.loads(analysis_path.read_text()).get("filename", "upload.xlsx")
                xlsx = folder / "original.xlsx"
                csv_p = folder / "original.csv"
                content = xlsx.read_bytes() if xlsx.exists() else csv_p.read_bytes() if csv_p.exists() else None
        if not content:
            raise HTTPException(404, "Upload file not found for discovery")
        session_id = upload_id.strip()
        work_folder = folder
    elif file and file.filename:
        content = await file.read()
        filename = file.filename
        if len(content) > 25 * 1024 * 1024:
            raise HTTPException(400, "File too large (max 25MB)")
        session_id = str(uuid.uuid4())[:8]
        work_folder = _upload_dir(f"discover-{session_id}")
        work_folder.mkdir(parents=True, exist_ok=True)
    else:
        raise HTTPException(400, "Provide a file or uploadId")

    try:
        user_answers = json_mod.loads(answers or "{}")
    except json_mod.JSONDecodeError:
        user_answers = {}

    result = run_discovery(content, filename, work_folder, user_answers, session_id)
    result["aiAvailable"] = anthropic_available()
    (work_folder / "discovery.json").write_text(json_mod.dumps(result, indent=2), encoding="utf-8")
    return result


@app.post("/api/companies/discover/confirm")
async def confirm_discovered_company(body: dict):
    """Save AI-proposed opco to registry."""
    from company_registry import create_company, defaults_from_company, list_companies_public

    payload = body.get("createPayload") or body
    try:
        company = create_company(payload)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e

    upload_id = body.get("uploadId")
    continue_merge = body.get("continueMerge", False)
    out = {"ok": True, "company": company, "companies": list_companies_public()}

    if continue_merge and upload_id:
        folder = _upload_dir(upload_id)
        analysis_path = folder / "analysis.json"
        meta_path = folder / "meta.json"
        if meta_path.exists():
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            meta["companyMatch"] = company
            meta["defaults"] = defaults_from_company(company, {})
            meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

        content = None
        filename = company.get("matchedFile") or "upload.xlsx"
        for name in ("original.xlsx", "original.csv"):
            path = folder / name
            if path.exists():
                content = path.read_bytes()
                break
        if analysis_path.exists() and not filename.endswith((".xlsx", ".csv")):
            filename = json.loads(analysis_path.read_text()).get("filename", filename)

        if content:
            data = _run_analyze_pipeline(
                upload_id,
                filename,
                content,
                folder,
                defaults_from_company(company, {}),
                use_ai=True,
            )
            data["companyMatch"] = company
            data["needsDiscovery"] = False
            analysis_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
            out["uploadId"] = upload_id
            out["analysis"] = data
        elif analysis_path.exists():
            analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
            analysis["companyMatch"] = company
            analysis["resolvedDefaults"] = defaults_from_company(company, {})
            analysis["suggestedContext"] = {
                "opco": company["opcoName"],
                "city": company["city"],
                "sourceSystem": company["sourceSystem"],
            }
            analysis["needsDiscovery"] = False
            analysis_path.write_text(json.dumps(analysis, indent=2), encoding="utf-8")
            out["uploadId"] = upload_id
            out["analysis"] = analysis

    return out


@app.post("/api/upload/analyze")
async def upload_analyze(
    file: UploadFile = File(...),
    opco: str = Form(""),
    city: str = Form(""),
    source_system: str = Form(""),
    use_ai: bool = Form(True),
):
    if not file.filename:
        raise HTTPException(400, "No file provided")

    name = file.filename.lower()
    if not (name.endswith(".csv") or name.endswith(".txt") or name.endswith(".xlsx") or name.endswith(".xls")):
        raise HTTPException(400, "Supported formats: .csv, .xlsx")

    content = await file.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 25MB)")

    upload_id = str(uuid.uuid4())[:8]
    folder = _upload_dir(upload_id)
    folder.mkdir(parents=True, exist_ok=True)

    user_defaults = {
        "opco": opco.strip(),
        "city": city.strip(),
        "source_system": source_system.strip(),
        "project_id": "PRJ-UNK-001",
    }

    data = _run_analyze_pipeline(upload_id, file.filename, content, folder, user_defaults, use_ai)
    (folder / "analysis.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
    save_upload_meta(upload_id, {
        "filename": file.filename,
        "defaults": data.get("resolvedDefaults", user_defaults),
        "status": "pending",
        "fileType": data.get("fileType", "csv"),
        "sheetName": data.get("sheetName"),
        "companyMatch": data.get("companyMatch"),
    })
    return data


@app.post("/api/upload/ingest")
async def upload_ingest(file: UploadFile = File(...)):
    """Scan upload thoroughly with trained profile (or AI), return analysis for review before merge."""
    if not file.filename:
        raise HTTPException(400, "No file provided")

    name = file.filename.lower()
    if not (name.endswith(".csv") or name.endswith(".txt") or name.endswith(".xlsx") or name.endswith(".xls")):
        raise HTTPException(400, "Supported formats: .csv, .xlsx")

    content = await file.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 25MB)")

    upload_id = str(uuid.uuid4())[:8]
    folder = _upload_dir(upload_id)
    folder.mkdir(parents=True, exist_ok=True)

    data = _run_analyze_pipeline(upload_id, file.filename, content, folder, {}, use_ai=True)
    (folder / "analysis.json").write_text(json.dumps(data, indent=2), encoding="utf-8")

    company_match = data.get("companyMatch")
    defaults = data.get("resolvedDefaults") or {}
    if company_match and not defaults.get("opco"):
        from company_registry import defaults_from_company
        defaults = defaults_from_company(company_match, {})

    save_upload_meta(upload_id, {
        "filename": file.filename,
        "defaults": defaults,
        "status": "pending",
        "fileType": data.get("fileType"),
        "sheetName": data.get("sheetName"),
        "companyMatch": company_match,
    })

    return {
        "merged": False,
        "uploadId": upload_id,
        "analysis": data,
        "needsDiscovery": data.get("needsDiscovery", False),
        "discoveryReason": data.get("discoveryReason"),
    }


@app.post("/api/upload/{upload_id}/confirm")
async def confirm_upload(upload_id: str, body: dict):
    analysis = _load_analysis(upload_id)
    if analysis.get("status") == "confirmed":
        raise HTTPException(400, "Upload already confirmed")
    return _run_confirm_pipeline(upload_id, analysis, body)


@app.get("/api/unified/stats")
def unified_stats():
    from unified_range import data_bounds
    from unified_schema import read_unified

    rows = read_unified()
    typed = store_stats()
    data_min, data_max, _ = data_bounds()
    if not rows:
        return {
            "totalRows": 0,
            "opcos": [],
            "systems": [],
            "cities": [],
            "unmappedGl": 0,
            "dataMinDate": None,
            "dataMaxDate": None,
            "stores": typed["stores"],
        }

    unmapped = sum(1 for r in rows if r.get("gl_category") == "unmapped")
    return {
        "totalRows": len(rows),
        "opcos": sorted({r["opco"] for r in rows}),
        "systems": sorted({r["source_system"] for r in rows}),
        "cities": sorted({r.get("city", "") for r in rows if r.get("city")}),
        "unmappedGl": unmapped,
        "dataMinDate": data_min.isoformat() if data_min else None,
        "dataMaxDate": data_max.isoformat() if data_max else None,
        "stores": typed["stores"],
    }


@app.get("/api/unified/summary")
def unified_summary(start: str, end: str):
    from datetime import date

    from unified_range import summarize_range

    try:
        start_date = date.fromisoformat(start[:10])
        end_date = date.fromisoformat(end[:10])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid date format — use YYYY-MM-DD") from exc

    return summarize_range(start_date, end_date)


@app.get("/api/forecast/scenario-window")
def get_scenario_window(scenario: str = "wet", opco: str = "all"):
    """Build forecast weeks for wet/dry quarter anchored to the extreme weather window."""
    from datetime import date

    from forecast import (
        build_scenario,
        forecast_meta,
        load_unified,
        load_weather,
        load_weather_by_city,
        opco_segments,
    )
    from scenario_windows import build_scenario_index, find_scenario_window
    from unified_schema import read_unified

    if scenario not in ("base", "wet", "dry"):
        raise HTTPException(status_code=400, detail="scenario must be base, wet, or dry")

    rows = read_unified()
    if not rows:
        raise HTTPException(status_code=404, detail="No unified data — upload first")

    for row in rows:
        row["txn_date"] = date.fromisoformat(str(row["date"])[:10])
        row["amount"] = float(row.get("amount") or 0)

    data_min = min(r["txn_date"] for r in rows)
    data_max = max(r["txn_date"] for r in rows)

    if scenario == "base":
        pick = {
            "anchorEnd": data_max.isoformat(),
            "forecastStart": "",
            "forecastEnd": "",
            "selectionReason": "Latest transaction anchor",
        }
        anchor = data_max
    else:
        index = build_scenario_index(rows)
        pick = index.get(scenario, {}).get(opco) or index.get(scenario, {}).get("all")
        if not pick:
            pick = find_scenario_window(scenario, opco, rows)
        anchor = date.fromisoformat(pick["anchorEnd"])

    unified, forecast_start, latest, _, _, _ = load_unified(anchor)
    if not unified:
        raise HTTPException(status_code=404, detail="No rows in selected 13-week window")

    weather_by_city = load_weather_by_city()
    base_delay = load_weather()
    segments = opco_segments(unified)
    weeks, traces = build_scenario(
        unified, segments, weather_by_city, base_delay, scenario, forecast_start,
    )

    meta = forecast_meta(forecast_start, latest, len(unified), len(rows), data_min, data_max)
    if scenario != "base":
        meta.update({
            "selectionReason": pick.get("selectionReason"),
            "stoppageDays": pick.get("stoppageDays"),
            "totalRainfallMm": pick.get("totalRainfallMm"),
            "rainDays": pick.get("rainDays"),
            "weatherCities": pick.get("cities"),
        })

    from forecast import trace_to_dict

    return {
        "meta": meta,
        "weeks": weeks,
        "traces": [trace_to_dict(t) for t in traces],
        "pick": pick,
    }


@app.post("/api/forecast/rebuild")
def forecast_rebuild(payload: dict):
    anchor_end = payload.get("anchorEnd")
    if not anchor_end:
        raise HTTPException(status_code=400, detail="anchorEnd is required (YYYY-MM-DD)")

    try:
        from datetime import date

        date.fromisoformat(str(anchor_end)[:10])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid anchorEnd — use YYYY-MM-DD") from exc

    py = ROOT / ".venv" / "bin" / "python"
    if not py.exists():
        py = Path(__file__).resolve().parent / "python3"
        cmd = ["python3", str(ROOT / "scripts" / "forecast.py"), "--anchor-end", str(anchor_end)[:10]]
    else:
        cmd = [str(py), str(ROOT / "scripts" / "forecast.py"), "--anchor-end", str(anchor_end)[:10]]

    try:
        subprocess.run(cmd, cwd=str(ROOT), check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.strip() or exc.stdout.strip() or "Forecast rebuild failed"
        raise HTTPException(status_code=500, detail=detail) from exc

    forecast_path = PUBLIC / "forecast.json"
    covenant_path = PUBLIC / "covenant_summary.json"
    if not forecast_path.exists():
        raise HTTPException(status_code=500, detail="Forecast output missing after rebuild")

    weather_ran, weather_error = _run_weather()

    result = {"forecast": json.loads(forecast_path.read_text(encoding="utf-8"))}
    if covenant_path.exists():
        result["covenant"] = json.loads(covenant_path.read_text(encoding="utf-8"))
    result["weatherRan"] = weather_ran
    if weather_error:
        result["weatherError"] = weather_error
    return result


@app.get("/api/unified/stores")
def unified_stores():
    return store_stats()


@app.get("/api/schedule/notifications")
def schedule_notifications():
    from schedule_planner import list_notifications

    return {"notifications": list_notifications()}


@app.get("/api/schedule/whatsapp/status")
def schedule_whatsapp_status():
    from whatsapp_bridge import whatsapp_status

    payload, status = whatsapp_status()
    if status >= 500:
        return {
            "connected": False,
            "bridgeOnline": False,
            "error": payload.get("error", "WhatsApp bridge offline"),
        }
    return {**payload, "bridgeOnline": True}


@app.get("/api/schedule/whatsapp/groups")
def schedule_whatsapp_groups():
    from whatsapp_bridge import whatsapp_groups

    payload, status = whatsapp_groups()
    if status != 200:
        raise HTTPException(status if status >= 400 else 503, payload.get("error", "Unavailable"))
    return payload


@app.post("/api/schedule/whatsapp/configure")
async def schedule_whatsapp_configure(body: dict):
    from whatsapp_bridge import whatsapp_configure

    group_jid = (body.get("groupJid") or "").strip()
    if not group_jid:
        raise HTTPException(400, "groupJid required")
    payload, status = whatsapp_configure(group_jid)
    if status != 200:
        raise HTTPException(status if status >= 400 else 503, payload.get("error", "Configure failed"))
    return payload


@app.post("/api/schedule/notify")
async def schedule_notify(body: dict):
    from schedule_planner import add_notification
    from whatsapp_bridge import whatsapp_send

    message = (body.get("message") or "").strip()
    if not message:
        raise HTTPException(400, "message required")

    wa_payload, wa_status = whatsapp_send(message)
    whatsapp_sent = wa_status == 200 and wa_payload.get("sent")
    channel = "WhatsApp (Baileys)" if whatsapp_sent else "Altis Crew WhatsApp (local log)"

    entry = add_notification(
        message=message,
        city=body.get("city", "All sites"),
        week_label=body.get("weekLabel", "W1"),
        channel=channel,
        author=body.get("author", "Field Schedule"),
    )
    entry["whatsappSent"] = whatsapp_sent
    if not whatsapp_sent:
        entry["whatsappError"] = wa_payload.get("error")
    return entry


@app.post("/api/schedule/ai-briefing")
async def schedule_ai_briefing(body: dict):
    from schedule_planner import ai_crew_briefing

    sites = body.get("sites") or []
    summary = body.get("weatherSummary") or ""
    text = ai_crew_briefing(
        sites,
        summary,
        body.get("dailyForecast"),
        body.get("viewMode", "week"),
        body.get("selectedDate"),
    )
    if not text:
        raise HTTPException(
            503,
            "AI briefing unavailable — set ANTHROPIC_API_KEY in .env and restart API",
        )
    return {"briefing": text, "aiUsed": True}


if __name__ == "__main__":
    UPLOADS.mkdir(parents=True, exist_ok=True)
    print(f"Altis ingest API — Anthropic AI: {anthropic_available()}")
    uvicorn.run(app, host="0.0.0.0", port=8000)
