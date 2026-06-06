"""Analyze uploaded CSV files: detect columns, source system, and GL accounts."""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from data_stores import resolve_store_routing
from unified_schema import GL_CATEGORIES, duplicate_stats, gl_category, load_gl_mapping_file, normalize_amount, parse_date

# Column name patterns → unified field
COLUMN_PATTERNS: dict[str, list[str]] = {
    "date": [
        "date", "datum", "boekingsdatum", "transaction_date", "txn_date",
        "booking_date", "posting_date", "transactiedatum", "factuurdatum",
        "factuur datum", "periode",
    ],
    "gl_account": [
        "gl_account", "grootboek", "account", "account_code", "gb", "gl",
        "ledger", "rekening", "accountnumber", "grootboekrekening",
    ],
    "amount": ["amount", "bedrag", "value", "waarde", "saldo"],
    "debit": ["debit", "debet", "debetbedrag", "debit_amount"],
    "credit": ["credit", "creditbedrag", "credit_amount"],
    "description": [
        "description", "omschrijving", "memo", "desc", "naam", "name",
        "tekst", "narrative",
    ],
    "opco": [
        "opco", "kostenplaats", "business_unit", "company", "bedrijf",
        "organisatie", "entity", "vestiging",
    ],
    "project_id": [
        "project_id", "project", "project_ref", "projectcode", "projectnr",
        "werk", "order",
    ],
    "source_system": ["source_system", "system", "bron", "source"],
    "city": ["city", "plaats", "locatie", "location"],
}

SYSTEM_HINTS: dict[str, list[str]] = {
    "Gilde": ["gilde", "dakwerk", "verkoopboek gilde"],
    "Yuki": ["yuki", "kostenplaats", "boekingsdatum", "grootboek", "bedrag"],
    "Exact": ["exact", "debet", "credit", "gb-nummer", "memoriaal", "dagboek", "bkst"],
    "Snelstart": ["snelstart", "dagboek"],
}

# Headers that look like GL but are journals / doc numbers / VAT
NON_GL_HEADERS = frozenset({
    "dagboek", "journal", "dagboekcode", "bkstnr", "bkst", "factuurnummer",
    "document", "boekstuk", "docnr",
})
NON_AMOUNT_HEADERS = frozenset({
    "btwbedrag", "btw", "vat", "vatamount", "belasting", "btwnr",
})
# Never map opco/city from transaction text columns
NON_CONTEXT_HEADERS = frozenset({
    "description", "journal", "dagboek", "omschrijving", "memo", "documentno",
    "invoice_no", "factuurnummer", "bkstnr", "sourcesheet", "amount", "debit",
    "credit", "date", "glaccount",
})

JOURNAL_GL_HINTS: list[tuple[str, str]] = [
    ("verkoop", "8000"),
    ("verkoopboek", "8000"),
    ("omzet", "8000"),
    ("inkoop", "4000"),
    ("memoriaal", "9000"),
    ("mem", "9000"),
    ("bank", "9000"),
    ("kas", "9000"),
    ("crediteur", "5000"),
    ("debiteur", "8000"),
]


@dataclass
class ColumnMapping:
    date: str | None = None
    gl_account: str | None = None
    amount: str | None = None
    debit: str | None = None
    credit: str | None = None
    description: str | None = None
    opco: str | None = None
    project_id: str | None = None
    source_system: str | None = None
    city: str | None = None

    def to_dict(self) -> dict[str, str | None]:
        return {
            "date": self.date,
            "gl_account": self.gl_account,
            "amount": self.amount,
            "debit": self.debit,
            "credit": self.credit,
            "description": self.description,
            "opco": self.opco,
            "project_id": self.project_id,
            "source_system": self.source_system,
            "city": self.city,
        }

    @classmethod
    def from_dict(cls, data: dict[str, str | None]) -> ColumnMapping:
        return cls(**{k: data.get(k) for k in cls.__dataclass_fields__})


@dataclass
class GlSuggestion:
    gl_account: str
    suggested_category: str
    confidence: float
    reason: str
    status: str = "pending"  # pending | approved | rejected

    def to_dict(self) -> dict:
        return {
            "glAccount": self.gl_account,
            "suggestedCategory": self.suggested_category,
            "confidence": self.confidence,
            "reason": self.reason,
            "status": self.status,
        }


@dataclass
class AnalysisResult:
    upload_id: str
    filename: str
    row_count: int
    headers: list[str]
    sample_rows: list[dict[str, str]]
    detected_system: str
    system_confidence: float
    column_mapping: ColumnMapping
    column_confidence: dict[str, float]
    gl_suggestions: list[GlSuggestion]
    sample_normalized: list[dict]
    warnings: list[str] = field(default_factory=list)
    ai_used: bool = False
    ai_briefing: dict | None = None
    sheet_name: str | None = None
    file_type: str = "csv"
    duplicate_check: dict | None = None
    store_routing: dict | None = None
    workbook_profile: dict | None = None
    dataset_profile: dict | None = None

    def to_dict(self) -> dict:
        out = {
            "uploadId": self.upload_id,
            "filename": self.filename,
            "rowCount": self.row_count,
            "headers": self.headers,
            "sampleRows": self.sample_rows,
            "detectedSystem": self.detected_system,
            "systemConfidence": self.system_confidence,
            "columnMapping": self.column_mapping.to_dict(),
            "columnConfidence": self.column_confidence,
            "glSuggestions": [g.to_dict() for g in self.gl_suggestions],
            "sampleNormalized": self.sample_normalized,
            "warnings": self.warnings,
            "aiUsed": self.ai_used,
            "availableCategories": list(GL_CATEGORIES),
            "availableColumns": self.headers,
            "fileType": self.file_type,
            "sheetName": self.sheet_name,
        }
        if self.ai_briefing:
            out["aiBriefing"] = self.ai_briefing
        if self.duplicate_check:
            out["duplicateCheck"] = self.duplicate_check
        if self.store_routing:
            out["storeRouting"] = self.store_routing
        if self.workbook_profile:
            out["workbookProfile"] = self.workbook_profile
        if self.dataset_profile:
            out["datasetProfile"] = self.dataset_profile
        return out


def _norm_header(h: str) -> str:
    return re.sub(r"[^a-z0-9]", "", h.lower().strip())


# Raw export labels → canonical merged CSV headers (multi-sheet xlsx)
HEADER_ALIASES: dict[str, str] = {
    "datum": "date",
    "factuurdatum": "date",
    "boekingsdatum": "date",
    "debet": "debit",
    "debetbedrag": "debit",
    "credit": "credit",
    "creditbedrag": "credit",
    "bedrag": "amount",
    "factuurbedrag": "amount",
    "dagboek": "journal",
    "omschrijving": "description",
    "bkstnr": "document_no",
    "factuurnummer": "invoice_no",
    "grootboek": "gl_account",
    "grootboekrekening": "gl_account",
    "btwbedrag": "amount",
}


def resolve_header(name: str | None, headers: list[str]) -> str | None:
    """Map AI/heuristic column name to an actual header in the file."""
    if not name:
        return None
    if name in headers:
        return name

    header_by_norm = {_norm_header(h): h for h in headers}
    norm = _norm_header(name)
    if norm in header_by_norm:
        return header_by_norm[norm]

    for h in headers:
        if norm in _norm_header(h) or _norm_header(h) in norm:
            return h

    alias = HEADER_ALIASES.get(norm)
    if alias and alias in headers:
        return alias
    if alias and alias in header_by_norm:
        return header_by_norm[alias]

    return None


def apply_ai_column_mapping(
    mapping: ColumnMapping,
    ai_mapping: dict[str, str | None],
    headers: list[str],
) -> list[str]:
    """Apply AI mapping only when columns resolve to real headers."""
    notes: list[str] = []
    skip_fields = {"opco", "city", "project_id", "source_system"}
    for field_name, raw in ai_mapping.items():
        if field_name in skip_fields:
            continue
        if field_name not in ColumnMapping.__dataclass_fields__ or not raw:
            continue
        resolved = resolve_header(raw, headers)
        if resolved:
            setattr(mapping, field_name, resolved)
        else:
            notes.append(f"AI mapped {field_name}→'{raw}' ignored (not in merged headers)")
    return notes


def journal_to_gl(journal_text: str) -> str:
    text = journal_text.lower()
    for hint, gl in JOURNAL_GL_HINTS:
        if hint in text:
            return gl
    m = re.search(r"\b([489]\d{3})\b", journal_text)
    if m:
        return m.group(1)
    return ""


def scan_column_dates(headers: list[str], rows: list[dict[str, str]]) -> tuple[str | None, dict[str, int]]:
    """Find column with most parseable dates; return column name + year counts."""
    from unified_schema import parse_date

    best_col: str | None = None
    best_count = 0
    best_years: dict[str, int] = {}

    for h in headers:
        years: dict[str, int] = {}
        parsed = 0
        for row in rows[:2000]:
            val = (row.get(h) or "").strip()
            if not val:
                continue
            try:
                iso = parse_date(val)
                parsed += 1
                years[iso[:4]] = years.get(iso[:4], 0) + 1
            except ValueError:
                continue
        if parsed > best_count:
            best_count = parsed
            best_col = h
            best_years = years

    return best_col, best_years


def refine_column_mapping(
    mapping: ColumnMapping,
    headers: list[str],
    rows: list[dict[str, str]],
) -> tuple[ColumnMapping, dict[str, float], list[str]]:
    """Fix common mis-maps (Dagboek as GL, BTW as amount) and infer dates by content."""
    confidence: dict[str, float] = {}
    notes: list[str] = []

    if mapping.gl_account and _norm_header(mapping.gl_account) in NON_GL_HEADERS:
        notes.append(f"Removed '{mapping.gl_account}' as GL — journal/doc column, not ledger code")
        mapping.gl_account = None

    if mapping.source_system and _norm_header(mapping.source_system) in {"sourcesheet", "sheet", "sourcesheetname"}:
        mapping.source_system = None

    for ctx_field in ("opco", "city", "project_id", "source_system"):
        col = getattr(mapping, ctx_field)
        if col and _norm_header(col) in NON_CONTEXT_HEADERS:
            notes.append(f"Removed {ctx_field}→'{col}' — set via company registry, not file column")
            setattr(mapping, ctx_field, None)

    if mapping.amount and _norm_header(mapping.amount) in NON_AMOUNT_HEADERS:
        notes.append(f"Removed '{mapping.amount}' as amount — VAT column, using debit/credit instead")
        mapping.amount = None

    if mapping.debit and mapping.credit:
        mapping.amount = None
        confidence.pop("amount", None)

    if not mapping.date and rows:
        inferred, years = scan_column_dates(headers, rows)
        if inferred:
            mapping.date = inferred
            confidence["date"] = 0.95
            year_list = ", ".join(f"{y} ({c})" for y, c in sorted(years.items()))
            notes.append(f"Date column inferred by content: '{inferred}' — years: {year_list}")

    if not mapping.description:
        for candidate in ("description", "journal", "dagboek", "omschrijving", "memo"):
            col = next((h for h in headers if _norm_header(h) == _norm_header(candidate)), None)
            if col:
                mapping.description = col
                confidence["description"] = 0.8
                break

    if not mapping.gl_account and mapping.description and rows:
        sample = next((r.get(mapping.description, "") for r in rows if r.get(mapping.description)), "")
        gl = journal_to_gl(sample)
        if gl:
            notes.append(f"GL inferred from journal/description → {gl}")

    return mapping, confidence, notes


def build_dataset_profile(rows: list[dict[str, str]], mapping: ColumnMapping) -> dict:
    from unified_schema import parse_date

    years: dict[str, int] = {}
    dates: list[str] = []
    sheets: dict[str, int] = {}

    date_col = mapping.date
    for row in rows:
        sheet = row.get("source_sheet", "")
        if sheet:
            sheets[sheet] = sheets.get(sheet, 0) + 1
        if not date_col:
            continue
        val = (row.get(date_col) or "").strip()
        if not val:
            continue
        try:
            iso = parse_date(val)
            dates.append(iso)
            years[iso[:4]] = years.get(iso[:4], 0) + 1
        except ValueError:
            continue

    dates.sort()
    return {
        "rowCount": len(rows),
        "dateRange": {"start": dates[0] if dates else None, "end": dates[-1] if dates else None},
        "yearBreakdown": years,
        "rowsBySheet": sheets,
        "hasDates": bool(dates),
    }


def detect_columns(headers: list[str]) -> tuple[ColumnMapping, dict[str, float]]:
    mapping = ColumnMapping()
    confidence: dict[str, float] = {}
    normalized = {_norm_header(h): h for h in headers}

    for field_name, patterns in COLUMN_PATTERNS.items():
        best_header: str | None = None
        best_score = 0.0
        for pattern in patterns:
            norm_pat = _norm_header(pattern)
            for norm_h, orig_h in normalized.items():
                if norm_h == norm_pat:
                    score = 1.0
                elif norm_pat in norm_h or norm_h in norm_pat:
                    score = 0.85
                else:
                    continue
                if score > best_score:
                    best_score = score
                    best_header = orig_h
        if best_header:
            setattr(mapping, field_name, best_header)
            confidence[field_name] = best_score

    return mapping, confidence


def detect_system(headers: list[str], sample_rows: list[dict]) -> tuple[str, float]:
    text = " ".join(headers).lower()
    for row in sample_rows[:3]:
        text += " " + " ".join(str(v) for v in row.values()).lower()

    scores: dict[str, float] = {}
    for system, hints in SYSTEM_HINTS.items():
        hits = sum(1 for h in hints if h in text)
        scores[system] = hits / max(len(hints), 1)

    if not scores or max(scores.values()) < 0.15:
        return "Unknown", 0.3

    best = max(scores, key=scores.get)
    return best, min(0.95, scores[best] + 0.2)


def read_csv_content(content: bytes, max_rows: int | None = None) -> tuple[list[str], list[dict[str, str]]]:
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("CSV has no header row")
    headers = [h.strip() for h in reader.fieldnames if h]
    rows: list[dict[str, str]] = []
    for i, row in enumerate(reader):
        if max_rows and i >= max_rows:
            break
        cleaned = {k.strip(): (v.strip() if v else "") for k, v in row.items() if k}
        if any(cleaned.values()):
            rows.append(cleaned)
    return headers, rows


def read_all_csv_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    content = path.read_bytes()
    return read_csv_content(content, max_rows=None)


def _cell(row: dict[str, str], col: str | None) -> str:
    if not col:
        return ""
    return row.get(col, "").strip()


def normalize_row(
    row: dict[str, str],
    mapping: ColumnMapping,
    defaults: dict[str, str],
) -> dict | None:
    try:
        date_col = mapping.date
        if not date_col:
            return None
        txn_date = parse_date(_cell(row, date_col))

        gl_col = mapping.gl_account
        gl = _cell(row, gl_col) if gl_col else ""
        if not gl:
            gl = _cell(row, "gl_account")
        if not gl and mapping.description:
            gl = journal_to_gl(_cell(row, mapping.description))
        if not gl:
            gl = "8000" if defaults.get("source_system", "").lower() in ("exact", "gilde") else "0000"
        if not gl:
            return None

        amount = 0.0
        if mapping.amount and _cell(row, mapping.amount):
            amount = normalize_amount(_cell(row, mapping.amount))
        elif mapping.debit or mapping.credit:
            deb = normalize_amount(_cell(row, mapping.debit) or "0")
            cred = normalize_amount(_cell(row, mapping.credit) or "0")
            amount = round(cred - deb, 2)
        else:
            return None

        if amount == 0:
            return None

        desc = _cell(row, mapping.description) or "Imported transaction"

        # Opco / city / source come from upload context (company registry) — never from row columns
        opco = defaults.get("opco", "Unknown Opco")
        city = defaults.get("city", "")
        source = defaults.get("source_system", "Unknown")
        project = defaults.get("project_id") or (
            f"PRJ-{city.upper().replace(' ', '')}-001" if city else "PRJ-UNK-001"
        )

        if not opco or opco == "Unknown Opco":
            return None

        return {
            "date": txn_date,
            "gl_account": gl,
            "amount": amount,
            "description": desc,
            "opco": opco,
            "project_id": project,
            "source_system": source,
            "city": city,
        }
    except (ValueError, TypeError):
        return None


def build_gl_suggestions(rows: list[dict], gl_map: dict[str, str]) -> list[GlSuggestion]:
    seen: set[str] = set()
    suggestions: list[GlSuggestion] = []
    for row in rows:
        gl = str(row.get("gl_account", "")).strip()
        if not gl or gl in seen:
            continue
        seen.add(gl)
        existing = gl_map.get(gl)
        if existing and existing != "unmapped":
            continue
        cat = gl_category(gl, gl_map)
        if cat != "unmapped":
            suggestions.append(GlSuggestion(gl, cat, 0.75, f"Rule: GL {gl} → {cat} (prefix/heuristic)"))
        else:
            suggestions.append(GlSuggestion(
                gl, "unmapped", 0.4,
                "No mapping rule — controller review required",
            ))
    return sorted(suggestions, key=lambda s: s.gl_account)


def normalize_all_rows(
    raw_rows: list[dict[str, str]],
    mapping: ColumnMapping,
    defaults: dict[str, str],
) -> tuple[list[dict], list[str]]:
    normalized: list[dict] = []
    warnings: list[str] = []
    skipped = 0
    for row in raw_rows:
        n = normalize_row(row, mapping, defaults)
        if n:
            normalized.append(n)
        else:
            skipped += 1
    if skipped:
        warnings.append(f"{skipped} rows skipped (missing date, GL, or zero amount)")
    return normalized, warnings


def analyze_csv(
    upload_id: str,
    filename: str,
    content: bytes,
    defaults: dict[str, str] | None = None,
    ai_enhancement: dict | None = None,
    file_type: str = "csv",
    sheet_name: str | None = None,
    workbook_profile: dict | None = None,
) -> AnalysisResult:
    defaults = defaults or {}
    headers, all_rows = read_csv_content(content, max_rows=None)
    sample_rows = all_rows[:8]

    if ai_enhancement and ai_enhancement.get("ai_briefing"):
        brief = ai_enhancement["ai_briefing"]
        if not defaults.get("opco") and brief.get("recommendedOpco"):
            defaults["opco"] = brief["recommendedOpco"]
        if not defaults.get("city") and brief.get("recommendedCity"):
            defaults["city"] = brief["recommendedCity"]

    if workbook_profile:
        if not defaults.get("opco") and workbook_profile.get("opcoHint"):
            defaults["opco"] = workbook_profile["opcoHint"]
        if not defaults.get("city") and workbook_profile.get("cityHint"):
            defaults["city"] = workbook_profile["cityHint"]

    mapping, col_conf = detect_columns(headers)
    mapping, refine_conf, refine_notes = refine_column_mapping(mapping, headers, all_rows)
    col_conf.update(refine_conf)
    ai_map_notes: list[str] = []
    if ai_enhancement and ai_enhancement.get("column_mapping"):
        ai_map_notes = apply_ai_column_mapping(
            mapping, ai_enhancement["column_mapping"], headers
        )

    mapping, refine_conf2, refine_notes2 = refine_column_mapping(mapping, headers, all_rows)
    col_conf.update(refine_conf2)

    detected_system, sys_conf = detect_system(headers, sample_rows)
    if ai_enhancement and ai_enhancement.get("detected_system"):
        detected_system = ai_enhancement["detected_system"]
        sys_conf = ai_enhancement.get("system_confidence", 0.85)

    if not defaults.get("source_system") and detected_system != "Unknown":
        defaults["source_system"] = detected_system

    warnings: list[str] = list(refine_notes) + list(ai_map_notes) + list(refine_notes2)
    if workbook_profile and len(workbook_profile.get("mergedSheets", [])) > 1:
        sheets = workbook_profile.get("mergedSheets", [])
        years = workbook_profile.get("yearBreakdown", {})
        year_txt = ", ".join(f"{y}: {c}" for y, c in sorted(years.items()))
        warnings.append(
            f"Multi-sheet workbook — merged {len(sheets)} tabs ({', '.join(sheets)}). Years: {year_txt or 'see profile'}"
        )
    if not mapping.date:
        warnings.append("Could not detect date column — please map manually")
    if not defaults.get("opco"):
        warnings.append("Select a portfolio company before merging — opco is not read from file columns")
    if not mapping.gl_account and not (mapping.debit and mapping.credit):
        warnings.append("Could not detect GL or debit/credit columns")
    if not mapping.amount and not (mapping.debit and mapping.credit):
        warnings.append("Could not detect amount column")

    normalized, norm_warnings = normalize_all_rows(all_rows, mapping, defaults)
    warnings.extend(norm_warnings)

    gl_map = load_gl_mapping_file()
    gl_suggestions = build_gl_suggestions(normalized, gl_map)
    if ai_enhancement and ai_enhancement.get("gl_suggestions"):
        ai_by_gl = {s["gl_account"]: s for s in ai_enhancement["gl_suggestions"]}
        for sug in gl_suggestions:
            if sug.gl_account in ai_by_gl:
                ai = ai_by_gl[sug.gl_account]
                sug.suggested_category = ai.get("category", sug.suggested_category)
                sug.confidence = ai.get("confidence", 0.85)
                sug.reason = ai.get("reason", sug.reason)

    ai_briefing = ai_enhancement.get("ai_briefing") if ai_enhancement else None
    ai_type = ai_briefing.get("dataType") if ai_briefing else None
    ai_target = ai_briefing.get("targetStore") if ai_briefing else None
    store_routing = resolve_store_routing(filename, normalized, ai_type, ai_target, gl_map)
    dup_check = duplicate_stats(normalized, store_routing)

    dataset_profile = build_dataset_profile(all_rows, mapping)
    if dataset_profile.get("hasDates") and ai_briefing:
        ai_briefing = dict(ai_briefing)
        ai_briefing["dateRange"] = dataset_profile["dateRange"]

    if dup_check["blockMerge"]:
        warnings.append(dup_check["message"])
    elif dup_check["duplicateRows"] > 0:
        warnings.append(dup_check["message"])

    return AnalysisResult(
        upload_id=upload_id,
        filename=filename,
        row_count=len(all_rows),
        headers=headers,
        sample_rows=sample_rows,
        detected_system=detected_system,
        system_confidence=sys_conf,
        column_mapping=mapping,
        column_confidence=col_conf,
        gl_suggestions=gl_suggestions,
        sample_normalized=normalized[:8],
        warnings=warnings,
        ai_used=bool(ai_enhancement),
        ai_briefing=ai_briefing,
        sheet_name=sheet_name,
        file_type=file_type,
        duplicate_check=dup_check,
        store_routing=store_routing,
        workbook_profile=workbook_profile,
        dataset_profile=dataset_profile,
    )
