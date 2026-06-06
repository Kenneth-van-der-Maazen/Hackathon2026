#!/usr/bin/env python3
"""FastAPI server: upload CSV/XLSX → Anthropic analysis → unified dataset."""

from __future__ import annotations

import csv
import json
import subprocess
import uuid
from pathlib import Path

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
    is_csv = name.endswith(".csv") or name.endswith(".txt")
    is_xlsx = name.endswith(".xlsx") or name.endswith(".xls")
    if not (is_csv or is_xlsx):
        raise HTTPException(400, "Supported formats: .csv, .xlsx")

    content = await file.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 25MB)")

    upload_id = str(uuid.uuid4())[:8]
    folder = _upload_dir(upload_id)
    folder.mkdir(parents=True, exist_ok=True)

    sheet_name = None
    file_type = "csv"
    csv_bytes = content

    if is_xlsx:
        file_type = "xlsx"
        (folder / "original.xlsx").write_bytes(content)
        headers, rows, sheet_name = save_xlsx_as_csv(content, folder / "converted.csv")
        csv_bytes = (folder / "converted.csv").read_bytes()
    else:
        (folder / "original.csv").write_bytes(content)

    defaults = {
        "opco": opco.strip(),
        "city": city.strip(),
        "source_system": source_system.strip(),
        "project_id": "PRJ-UNK-001",
    }

    ai_enhancement = None
    if use_ai and anthropic_available():
        headers, samples = read_csv_content(csv_bytes, max_rows=8)
        raw = analyze_with_anthropic(file.filename, headers, samples, sheet_name or "")
        if raw:
            ai_enhancement = to_enhancement(raw)

    result = analyze_csv(
        upload_id,
        file.filename,
        csv_bytes,
        defaults,
        ai_enhancement,
        file_type=file_type,
        sheet_name=sheet_name,
    )
    data = result.to_dict()
    data["status"] = "pending"
    if ai_enhancement and ai_enhancement.get("notes"):
        data["aiNotes"] = ai_enhancement["notes"]

    (folder / "analysis.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
    save_upload_meta(upload_id, {
        "filename": file.filename,
        "defaults": defaults,
        "status": "pending",
        "fileType": file_type,
        "sheetName": sheet_name,
    })

    return data


@app.post("/api/upload/{upload_id}/confirm")
async def confirm_upload(upload_id: str, body: dict):
    analysis = _load_analysis(upload_id)
    if analysis.get("status") == "confirmed":
        raise HTTPException(400, "Upload already confirmed")

    column_mapping = ColumnMapping.from_dict(body.get("columnMapping", analysis.get("columnMapping", {})))
    meta_path = _upload_dir(upload_id) / "meta.json"
    defaults = {}
    if meta_path.exists():
        defaults = json.loads(meta_path.read_text()).get("defaults", {})

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
    approved = body.get("glApprovals", {})
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
        notes.append(f"AI summary: {analysis['aiBriefing']['summary'][:200]}")
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

    forecast_ran = False
    forecast_error = None
    forecast_script = ROOT / "scripts" / "forecast.py"
    if forecast_script.exists():
        try:
            subprocess.run(
                [str(ROOT / ".venv" / "bin" / "python"), str(forecast_script)],
                cwd=ROOT,
                check=True,
                capture_output=True,
                text=True,
                timeout=120,
            )
            forecast_ran = True
        except Exception as e:
            forecast_error = str(e)

    return {
        "ok": True,
        "rowsAdded": added,
        "rowsAddedByStore": added_by_store,
        "duplicateRowsSkipped": len(normalized) - added,
        "totalRows": len(all_rows),
        "storeRouting": routing,
        "forecastRan": forecast_ran,
        "forecastError": forecast_error,
        "warnings": warnings,
    }


@app.get("/api/unified/stats")
def unified_stats():
    from unified_schema import read_unified

    rows = read_unified()
    typed = store_stats()
    if not rows:
        return {
            "totalRows": 0,
            "opcos": [],
            "systems": [],
            "cities": [],
            "unmappedGl": 0,
            "stores": typed["stores"],
        }

    unmapped = sum(1 for r in rows if r.get("gl_category") == "unmapped")
    return {
        "totalRows": len(rows),
        "opcos": sorted({r["opco"] for r in rows}),
        "systems": sorted({r["source_system"] for r in rows}),
        "cities": sorted({r.get("city", "") for r in rows if r.get("city")}),
        "unmappedGl": unmapped,
        "stores": typed["stores"],
    }


@app.get("/api/unified/stores")
def unified_stores():
    return store_stats()


if __name__ == "__main__":
    UPLOADS.mkdir(parents=True, exist_ok=True)
    print(f"Altis ingest API — Anthropic AI: {anthropic_available()}")
    uvicorn.run(app, host="0.0.0.0", port=8000)
