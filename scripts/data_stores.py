"""Route ingested files into typed unified CSV stores."""

from __future__ import annotations

from typing import Any

DATA_STORES: dict[str, dict[str, Any]] = {
    "revenue": {
        "id": "revenue",
        "file": "unified_revenue.csv",
        "label": "Revenue & billing",
        "description": "Sales, milestone billing, GL 8xxx (Omzet)",
        "examples": "Exact GB 8000 exports, Verkoop journals",
    },
    "costs": {
        "id": "costs",
        "file": "unified_costs.csv",
        "label": "Operating costs",
        "description": "Materials & subcontractors, GL 4xxx / 5xxx",
        "examples": "Material purchases, subcontractor payments",
    },
    "overhead": {
        "id": "overhead",
        "file": "unified_overhead.csv",
        "label": "Overhead",
        "description": "Indirect costs, GL 9xxx",
        "examples": "Admin, rent, insurance",
    },
    "ledger": {
        "id": "ledger",
        "file": "unified_ledger.csv",
        "label": "General ledger",
        "description": "Mixed or uncategorized journal lines",
        "examples": "Yuki FinTransactions spanning multiple GL types",
    },
}

# Zip / hackathon file patterns (from data/incoming README)
FILENAME_STORE_HINTS: list[tuple[tuple[str, ...], str]] = [
    (("gb 800", "8000", "8001", "8002", "omzet", "verkoop", "revenue", "billing"), "revenue"),
    (("gb 400", "gb 500", "4000", "5000", "material", "subcontract", "inkoop"), "costs"),
    (("gb 900", "9000", "overhead", "bedrijfskosten"), "overhead"),
    (("fintransaction", "fintransactions"), "mixed"),  # Yuki: one GL per file, classified by row
    (("altis dataset 1", "p&l", " winst"), "mixed"),  # Gilde monthly P&L — split by GL row
    (("altis dataset 2", "dagboek", "journal"), "revenue"),  # Winschoten Verkoop journals
]

AI_TYPE_TO_STORE = {
    "revenue": "revenue",
    "billing": "revenue",
    "transactions": "mixed",
    "mixed": "mixed",
    "pl": "mixed",
    "costs": "costs",
    "overhead": "overhead",
    "wip": "ledger",  # WIP milestone CSV uses separate schema — flag in UI
    "unknown": "mixed",
}


def store_catalog() -> list[dict]:
    return list(DATA_STORES.values())


def infer_store_from_filename(filename: str) -> str | None:
    name = filename.lower().replace("_", " ")
    for patterns, store in FILENAME_STORE_HINTS:
        if any(p in name for p in patterns):
            return store
    return None


def classify_row_store(row: dict, gl_map: dict | None = None) -> str:
    from unified_schema import gl_category

    gl = str(row.get("gl_account", "")).strip()
    gl_lower = gl.lower()
    desc = str(row.get("description", "")).lower()
    combined = f"{gl_lower} {desc}"

    if any(k in combined for k in ("verkoop", "omzet", "billing", "8000", "8001", "8002")):
        return "revenue"
    if any(k in combined for k in ("inkoop", "material", "subcontract", "leverancier")):
        return "costs"
    if any(k in combined for k in ("bedrijfskosten", "overhead")):
        return "overhead"

    cat = row.get("gl_category") or gl_category(gl, gl_map)
    if cat == "billing" or gl.startswith("8"):
        return "revenue"
    if cat in ("materials", "subcontractors") or gl.startswith(("4", "5")):
        return "costs"
    if cat == "overhead" or gl.startswith("9"):
        return "overhead"
    return "ledger"


def route_rows(
    rows: list[dict],
    primary_store: str | None = None,
    gl_map: dict | None = None,
) -> dict[str, list[dict]]:
    buckets: dict[str, list[dict]] = {sid: [] for sid in DATA_STORES}
    force_single = primary_store and primary_store not in ("mixed", "unknown")

    for row in rows:
        if force_single:
            store = primary_store
        else:
            store = classify_row_store(row, gl_map)
        buckets[store].append(row)
    return buckets


def resolve_store_routing(
    filename: str,
    normalized_rows: list[dict],
    ai_data_type: str | None = None,
    ai_target_store: str | None = None,
    gl_map: dict | None = None,
) -> dict:
    """Decide target store(s) for an upload."""
    filename_hint = infer_store_from_filename(filename)
    ai_store = AI_TYPE_TO_STORE.get((ai_data_type or "").lower())
    if ai_target_store and ai_target_store in DATA_STORES:
        primary = ai_target_store
    elif ai_store:
        primary = ai_store
    elif filename_hint:
        primary = filename_hint
    else:
        primary = "mixed"

    buckets = route_rows(normalized_rows, primary if primary != "mixed" else None, gl_map)
    counts = {sid: len(buckets[sid]) for sid in DATA_STORES}
    active_stores = [sid for sid, n in counts.items() if n > 0]

    if len(active_stores) == 1:
        target = active_stores[0]
        mixed = False
    elif primary != "mixed" and counts.get(primary, 0) == len(normalized_rows):
        target = primary
        mixed = False
    else:
        target = "mixed"
        mixed = True

    reason_parts = []
    if filename_hint:
        reason_parts.append(f"Filename suggests {DATA_STORES.get(filename_hint, {}).get('label', filename_hint)}")
    if ai_data_type:
        reason_parts.append(f"AI classified as {ai_data_type}")
    if mixed:
        reason_parts.append("Rows split across stores by GL account prefix")
    else:
        reason_parts.append(f"All rows → {DATA_STORES[target]['label']}")

    return {
        "targetStore": target,
        "mixed": mixed,
        "rowCountsByStore": counts,
        "activeStores": active_stores,
        "filenameHint": filename_hint,
        "reason": ". ".join(reason_parts) + ".",
        "stores": [
            {
                "id": sid,
                "label": DATA_STORES[sid]["label"],
                "file": DATA_STORES[sid]["file"],
                "rowCount": counts[sid],
            }
            for sid in DATA_STORES
            if counts[sid] > 0
        ],
    }
