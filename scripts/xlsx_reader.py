"""Parse Excel uploads into tabular rows for the ingest pipeline."""

from __future__ import annotations

import csv
import io
from datetime import date, datetime
from pathlib import Path

import openpyxl


def _cell_str(value) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float) and value == int(value):
        return str(int(value))
    return str(value).strip()


def _try_yuki_fintransactions(ws) -> tuple[list[str], list[dict[str, str]], int] | None:
    """Yuki exports: metadata rows then header row starting with Nr."""
    gl_code = ""
    header_idx: int | None = None
    scanned: list[tuple] = []
    for row in ws.iter_rows(values_only=True):
        scanned.append(row)
        if row and row[0] == "Grootboekrekening" and row[1]:
            gl_code = str(row[1]).split(" - ")[0].strip()
        if header_idx is None and row and str(row[0]).strip() == "Nr.":
            header_idx = len(scanned) - 1
    if header_idx is None:
        return None

    header_row = scanned[header_idx]
    headers = [_cell_str(h) or f"col_{j}" for j, h in enumerate(header_row)]
    if "gl_account" not in headers:
        headers = [*headers, "gl_account"]

    rows: list[dict[str, str]] = []
    for row in scanned[header_idx + 1 :]:
        values = [_cell_str(v) for v in row]
        if not any(values):
            continue
        if values[0] == "" and not values[2]:
            continue
        padded = values + [""] * max(0, len(headers) - 1 - len(values))
        record = dict(zip(headers[:-1], padded[: len(headers) - 1]))
        record["gl_account"] = gl_code
        rows.append(record)
    return headers, rows, len(rows) + 500


def xlsx_to_rows(content: bytes, max_rows: int | None = None) -> tuple[list[str], list[dict[str, str]], str]:
    """Return headers, rows, and sheet name from the best worksheet."""
    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    best_sheet = None
    best_score = -1
    best_headers: list[str] = []
    best_rows: list[dict[str, str]] = []

    for name in wb.sheetnames:
        ws = wb[name]

        yuki = _try_yuki_fintransactions(ws)
        if yuki:
            headers, rows, score = yuki
            if max_rows is not None:
                rows = rows[:max_rows]
            if score > best_score:
                best_score = score
                best_sheet = name
                best_headers = headers
                best_rows = rows
            continue

        rows_iter = ws.iter_rows(values_only=True)
        try:
            header_row = next(rows_iter)
        except StopIteration:
            continue
        headers = [_cell_str(h) or f"col_{i}" for i, h in enumerate(header_row)]
        if not any(headers):
            continue

        rows: list[dict[str, str]] = []
        for i, row in enumerate(rows_iter):
            if max_rows is not None and i >= max_rows:
                break
            values = [_cell_str(v) for v in row]
            if not any(values):
                continue
            padded = values + [""] * max(0, len(headers) - len(values))
            rows.append(dict(zip(headers, padded[: len(headers)])))

        score = len(rows) + (10 if any("grootboek" in h.lower() or "account" in h.lower() or h.lower() == "rekening" for h in headers) else 0)
        if score > best_score:
            best_score = score
            best_sheet = name
            best_headers = headers
            best_rows = rows

    wb.close()
    if not best_headers:
        raise ValueError("No usable worksheet found in Excel file")
    return best_headers, best_rows, best_sheet or "Sheet1"


def rows_to_csv_bytes(headers: list[str], rows: list[dict[str, str]]) -> bytes:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=headers, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")


def save_xlsx_as_csv(content: bytes, dest: Path) -> tuple[list[str], list[dict[str, str]], str]:
    headers, rows, sheet = xlsx_to_rows(content)
    dest.write_bytes(rows_to_csv_bytes(headers, rows))
    return headers, rows, sheet
