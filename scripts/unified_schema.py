"""Shared unified data schema, deduplication, and persistence."""

from __future__ import annotations

import csv
import hashlib
import json
from datetime import datetime
from pathlib import Path

from data_stores import DATA_STORES, route_rows, store_catalog

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "output"
PUBLIC = ROOT / "public" / "data"
UPLOADS = ROOT / "data" / "uploads"
MASTER_FILE = "unified_data.csv"

UNIFIED_HEADERS = [
    "date",
    "gl_account",
    "amount",
    "description",
    "opco",
    "project_id",
    "source_system",
    "gl_category",
    "city",
]

GL_CATEGORIES = (
    "materials",
    "subcontractors",
    "billing",
    "payment_lag",
    "overhead",
    "unmapped",
)

# Known GL → category (extend via upload review)
DEFAULT_GL_MAP: dict[str, str] = {
    "4000": "materials",
    "4010": "materials",
    "4020": "materials",
    "5000": "subcontractors",
    "5010": "subcontractors",
    "8000": "billing",
    "8001": "billing",
    "8002": "billing",
    "8004": "billing",
    "8005": "billing",
    "80000": "billing",
    "80020": "billing",
    "9000": "overhead",
    "9010": "overhead",
}


def gl_category(gl: str, gl_map: dict[str, str] | None = None) -> str:
    gl = str(gl).strip()
    mapping = gl_map or DEFAULT_GL_MAP
    if gl in mapping:
        return mapping[gl]
    if gl.startswith("4"):
        return "materials"
    if gl.startswith("5"):
        return "subcontractors"
    if gl.startswith("8"):
        return "billing"
    if gl.startswith("9"):
        return "overhead"
    return "unmapped"


def row_key(date: str, gl: str, amount: float, project: str, source: str) -> str:
    raw = f"{date}|{gl}|{amount:.2f}|{project}|{source}"
    return hashlib.md5(raw.encode()).hexdigest()


def parse_date(value: str) -> str:
    value = str(value).strip()
    if not value:
        raise ValueError("Empty date")
    if " " in value:
        value = value.split(" ")[0]
    if "T" in value:
        value = value.split("T")[0]
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    raise ValueError(f"Unparseable date: {value}")


def normalize_amount(value: str | float | int) -> float:
    if isinstance(value, (int, float)):
        return round(float(value), 2)
    cleaned = str(value).replace("€", "").replace(",", "").strip()
    if cleaned.startswith("(") and cleaned.endswith(")"):
        cleaned = "-" + cleaned[1:-1]
    return round(float(cleaned), 2)


def load_gl_mapping_file() -> dict[str, str]:
    """Load approved GL mapping from output or raw."""
    mapping = dict(DEFAULT_GL_MAP)
    for path in (OUT / "gl_mapping.csv", ROOT / "data" / "raw" / "gl_account_mapping.csv"):
        if not path.exists():
            continue
        with path.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                gl = row.get("gl_account", "").strip()
                cat = row.get("category", "").strip()
                if gl and cat and cat != "unmapped":
                    mapping[gl] = cat
    return mapping


def read_unified() -> list[dict]:
    """Read combined master ledger (all stores)."""
    master = OUT / MASTER_FILE
    if master.exists() and master.stat().st_size > 50:
        with master.open(encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
            if rows:
                return rows
    return read_all_stores()


def read_store(store_id: str) -> list[dict]:
    if store_id not in DATA_STORES:
        return []
    path = OUT / DATA_STORES[store_id]["file"]
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def read_all_stores() -> list[dict]:
    rows: list[dict] = []
    for sid in DATA_STORES:
        rows.extend(read_store(sid))
    return rows


def _existing_keys(rows: list[dict]) -> set[str]:
    return {
        row_key(r["date"], r["gl_account"], float(r["amount"]), r["project_id"], r["source_system"])
        for r in rows
    }


def merge_rows_into_store(
    store_id: str,
    new_rows: list[dict],
    gl_map: dict[str, str],
) -> tuple[list[dict], int]:
    if store_id not in DATA_STORES:
        raise ValueError(f"Unknown store: {store_id}")
    existing = read_store(store_id)
    seen = _existing_keys(existing)
    added = 0
    for row in new_rows:
        row["gl_category"] = gl_category(row["gl_account"], gl_map)
        key = row_key(row["date"], row["gl_account"], float(row["amount"]), row["project_id"], row["source_system"])
        if key in seen:
            continue
        seen.add(key)
        existing.append(row)
        added += 1
    return existing, added


def merge_rows_routed(
    new_rows: list[dict],
    gl_map: dict[str, str],
    routing: dict,
) -> tuple[dict[str, list[dict]], dict[str, int], int]:
    """Merge into typed stores; return merged per store, added counts, total added."""
    target = routing.get("targetStore", "mixed")
    buckets = route_rows(
        new_rows,
        None if target == "mixed" else target,
        gl_map,
    )
    merged_by_store: dict[str, list[dict]] = {}
    added_by_store: dict[str, int] = {}
    total_added = 0
    for sid, rows in buckets.items():
        if not rows:
            continue
        merged, added = merge_rows_into_store(sid, rows, gl_map)
        merged_by_store[sid] = merged
        added_by_store[sid] = added
        total_added += added
    return merged_by_store, added_by_store, total_added


def write_store(store_id: str, rows: list[dict]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / DATA_STORES[store_id]["file"]
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=UNIFIED_HEADERS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def rebuild_master_unified() -> list[dict]:
    """Combine all typed stores into unified_data.csv for forecast pipeline."""
    all_rows = read_all_stores()
    OUT.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    with (OUT / MASTER_FILE).open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=UNIFIED_HEADERS, extrasaction="ignore")
        w.writeheader()
        w.writerows(all_rows)
    (PUBLIC / MASTER_FILE).write_text((OUT / MASTER_FILE).read_text(encoding="utf-8"), encoding="utf-8")
    for sid in DATA_STORES:
        src = OUT / DATA_STORES[sid]["file"]
        if src.exists():
            (PUBLIC / DATA_STORES[sid]["file"]).write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    return all_rows


def store_stats() -> dict:
    stats = {}
    for sid, meta in DATA_STORES.items():
        rows = read_store(sid)
        stats[sid] = {"label": meta["label"], "file": meta["file"], "rowCount": len(rows)}
    all_rows = read_all_stores()
    return {
        "totalRows": len(all_rows),
        "stores": stats,
        "storeCatalog": store_catalog(),
    }


def merge_rows(
    new_rows: list[dict],
    gl_map: dict[str, str],
    routing: dict | None = None,
) -> tuple[list[dict], int]:
    """Route rows into typed stores, rebuild master, return (all_rows, added_count)."""
    from data_stores import resolve_store_routing

    if not routing:
        routing = resolve_store_routing("upload.csv", new_rows, gl_map=gl_map)
    merged_by_store, _, total_added = merge_rows_routed(new_rows, gl_map, routing)
    if merged_by_store:
        write_stores_and_master(merged_by_store, gl_map)
    return read_unified(), total_added


def duplicate_stats(normalized_rows: list[dict], routing: dict | None = None) -> dict:
    """Compare normalized upload rows against target store(s)."""
    from data_stores import resolve_store_routing

    total = len(normalized_rows)
    if total == 0:
        return {
            "totalRows": 0,
            "duplicateRows": 0,
            "newRows": 0,
            "duplicatePercent": 0.0,
            "blockMerge": True,
            "status": "empty",
            "message": "No valid rows to merge after normalization.",
            "storeRouting": routing,
        }

    if not routing:
        routing = resolve_store_routing("upload.csv", normalized_rows)

    target = routing.get("targetStore", "mixed")
    buckets = route_rows(
        normalized_rows,
        None if target == "mixed" else target,
    )

    duplicate_rows = 0
    new_by_store: dict[str, int] = {}
    dup_by_store: dict[str, int] = {}

    for sid, rows in buckets.items():
        if not rows:
            continue
        existing_keys = _existing_keys(read_store(sid))
        store_new = 0
        store_dup = 0
        for row in rows:
            key = row_key(row["date"], row["gl_account"], float(row["amount"]), row["project_id"], row["source_system"])
            if key in existing_keys:
                store_dup += 1
                duplicate_rows += 1
            else:
                store_new += 1
        new_by_store[sid] = store_new
        dup_by_store[sid] = store_dup

    new_rows = total - duplicate_rows
    duplicate_percent = round((duplicate_rows / total) * 100, 1)
    block_merge = new_rows == 0

    store_label = (
        DATA_STORES[target]["label"]
        if target in DATA_STORES
        else "multiple stores"
    )

    if block_merge:
        status = "all_duplicate"
        message = (
            f"All {total:,} rows already exist in the central database "
            f"({store_label}). Upload blocked to prevent duplicates."
        )
    elif duplicate_rows > 0:
        status = "partial_duplicate"
        parts = [f"{dup_by_store[sid]:,} dup → {DATA_STORES[sid]['label']}" for sid in dup_by_store if dup_by_store[sid]]
        message = (
            f"{duplicate_rows:,} of {total:,} rows already stored"
            + (f" ({'; '.join(parts)})" if parts else "")
            + f". Only {new_rows:,} new row(s) will be merged."
        )
    else:
        status = "all_new"
        if routing.get("mixed"):
            parts = [f"{new_by_store[sid]:,} → {DATA_STORES[sid]['label']}" for sid in new_by_store if new_by_store[sid]]
            message = f"All {total:,} rows are new. Split: {'; '.join(parts)}."
        else:
            message = f"All {total:,} rows are new → {store_label} ({DATA_STORES.get(target, {}).get('file', MASTER_FILE)})."

    return {
        "totalRows": total,
        "duplicateRows": duplicate_rows,
        "newRows": new_rows,
        "duplicatePercent": duplicate_percent,
        "blockMerge": block_merge,
        "status": status,
        "message": message,
        "storeRouting": routing,
        "newRowsByStore": new_by_store,
        "duplicateRowsByStore": dup_by_store,
    }


def write_unified(rows: list[dict], gl_map: dict[str, str], notes_extra: list[str] | None = None) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)

    for r in rows:
        r["gl_category"] = gl_category(r["gl_account"], gl_map)

    with (OUT / MASTER_FILE).open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=UNIFIED_HEADERS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    discovered = {r["gl_account"] for r in rows}
    mapping_rows = []
    for gl in sorted(discovered, key=lambda x: (len(x), x)):
        cat = gl_category(gl, gl_map)
        status = "mapped" if cat != "unmapped" else "flagged"
        mapping_rows.append({"gl_account": gl, "category": cat, "status": status})

    with (OUT / "gl_mapping.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["gl_account", "category", "status"])
        w.writeheader()
        w.writerows(mapping_rows)

    unmapped = sum(1 for r in mapping_rows if r["category"] == "unmapped")
    notes = [
        "Unified data — Altis Groep Cash Flow",
        "",
        f"Total rows (master): {len(rows)}",
        f"Opcos: {len({r['opco'] for r in rows}) if rows else 0}",
        f"Unmapped GL accounts: {unmapped}",
        "Typed stores: revenue, costs, overhead, ledger — see unified_*.csv",
        "Sign convention: outflows negative, inflows positive (EUR)",
        "Duplicates removed via hash key (date+gl+amount+project+source)",
    ]
    if notes_extra:
        notes.extend(["", *notes_extra])
    (OUT / "data_notes.txt").write_text("\n".join(notes), encoding="utf-8")

    publish_files = [MASTER_FILE, "gl_mapping.csv", "data_notes.txt", *[m["file"] for m in DATA_STORES.values()]]
    for name in publish_files:
        src = OUT / name
        if src.exists():
            (PUBLIC / name).write_text(src.read_text(encoding="utf-8"), encoding="utf-8")


def write_stores_and_master(
    merged_by_store: dict[str, list[dict]],
    gl_map: dict[str, str],
    notes_extra: list[str] | None = None,
) -> list[dict]:
    for sid, rows in merged_by_store.items():
        write_store(sid, rows)
    all_rows = rebuild_master_unified()
    write_unified(all_rows, gl_map, notes_extra)
    return all_rows


def save_upload_meta(upload_id: str, meta: dict) -> None:
    folder = UPLOADS / upload_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
