# Drop your hackathon data here

You dropped **3 zip files** — that's fine. The parser extracts them automatically.

## Your data → company locations

The source files don't include location. Use this mapping (from the data owner):

| Zip / folder | Company location | Accounting system |
|--------------|------------------|-------------------|
| `portfolio company data` | **Heeze** | Exact (GB 8000/8001/8002) |
| `portfolio company 2 data` | **Brunssum** (Peter Ummels) | Yuki |
| `Altis dataset 1.xlsx` | **Andijk** | Gilde (monthly P&L) |
| `Altis dataset 2.xlsx` | **Winschoten** | Exact (journal) |

Location mapping is stored in [`opco_locations.json`](opco_locations.json).

## File types → unified CSV stores

Uploads are **not** dumped into one file. AI + GL rules route each file to the correct store:

| Store | CSV file | Typical source files |
|-------|----------|----------------------|
| **Revenue & billing** | `unified_revenue.csv` | Exact `GB 8000*.xlsx`, Verkoop journals, GL 8xxx |
| **Operating costs** | `unified_costs.csv` | GL 4xxx materials, 5xxx subcontractors |
| **Overhead** | `unified_overhead.csv` | GL 9xxx bedrijfskosten |
| **General ledger** | `unified_ledger.csv` | Mixed Yuki FinTransactions |
| **Mixed P&L** | Split by GL row | Gilde `Altis dataset 1` monthly sheets |

`unified_data.csv` is the **combined master** used by the forecast (auto-rebuilt after each merge).

## After dropping zip files

```bash
cd altis-cashflow
npm run data:pipeline
npm run dev
```

Or use the **Data Upload** UI — drop Excel/CSV and confirm the AI routing before merge.

## Files accepted

- `*.zip` — auto-extracted to `extracted/`
- Pre-extracted xlsx in `extracted/` also works
- Direct `.xlsx` / `.csv` via upload UI

You do **not** need to rename files to `gilde_export.csv` etc.
