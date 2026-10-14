"""Data Understanding Engine (Layer 3-A).

pandas-based schema/type inference, missing-value profiling, duplicate detection,
and data-quality scoring. Works on rows preserved as raw strings so source
identifiers and lineage stay intact; numeric/date views are parsed per analysis.
"""

import logging
from datetime import datetime

import numpy as np
import pandas as pd

logger = logging.getLogger("zayotm.data")

MANDATORY_COLUMNS = {"purchase_orders": ["po_id", "supplier_id", "total_amount", "needed_by", "department"]}


def infer_type(values: pd.Series) -> str:
    non_null = values[values.astype(str).str.strip() != ""]
    if non_null.empty:
        return "empty"
    sample = non_null.astype(str)
    if sample.str.fullmatch(r"-?\d+").mean() >= 0.9:
        return "integer"
    if sample.str.fullmatch(r"-?\d+(\.\d+)?").mean() >= 0.9:
        return "float"
    if pd.to_datetime(sample, format="mixed", errors="coerce").notna().mean() >= 0.9:
        return "date"
    if sample.str.lower().isin(["true", "false", "yes", "no"]).mean() >= 0.95:
        return "boolean"
    return "string"


def profile_file(file_name: str, rows: list[dict]) -> dict:
    """Profile one source file (list of raw string dicts)."""
    df = pd.DataFrame(rows)
    columns = []
    total_cells = len(df) * max(len(df.columns), 1)
    missing_cells = 0
    validity_rates = []

    for col in df.columns:
        series = df[col].astype(str)
        missing = int((series.str.strip() == "").sum())
        missing_cells += missing
        ctype = infer_type(series)
        non_null = series[series.str.strip() != ""]
        # validity: can values parse as their inferred type?
        validity = 1.0
        if ctype in ("integer", "float") and not non_null.empty:
            validity = float(pd.to_numeric(non_null, errors="coerce").notna().mean())
        elif ctype == "date" and not non_null.empty:
            validity = float(pd.to_datetime(non_null, format="mixed", errors="coerce").notna().mean())
        validity_rates.append(validity)
        columns.append(
            {
                "name": col,
                "inferred_type": ctype,
                "non_null": int(len(df) - missing),
                "missing": missing,
                "missing_pct": round(100 * missing / max(len(df), 1), 1),
                "distinct": int(series.nunique()),
                "samples": non_null.head(3).tolist(),
            }
        )

    # duplicate full rows
    dup_count = int(df.duplicated().sum()) if not df.empty else 0

    # consistency: purchase-order amount vs quantity*unit_price
    consistency = 1.0
    if file_name == "purchase_orders" and {"quantity", "unit_price", "total_amount"}.issubset(df.columns):
        q = pd.to_numeric(df["quantity"], errors="coerce")
        u = pd.to_numeric(df["unit_price"], errors="coerce")
        t = pd.to_numeric(df["total_amount"], errors="coerce")
        expected = q * u
        mask = expected.notna() & t.notna() & (t > 0)
        if mask.any():
            consistency = float((abs(t[mask] - expected[mask]) / t[mask] <= 0.02).mean())

    completeness = 1.0 - (missing_cells / total_cells if total_cells else 0.0)
    validity = float(np.mean(validity_rates)) if validity_rates else 1.0
    score = round(100 * (0.4 * completeness + 0.3 * validity + 0.3 * consistency))

    issues = []
    if completeness < 1.0:
        issues.append(f"missing values: {missing_cells} empty cells")
    if dup_count:
        issues.append(f"{dup_count} duplicate row(s)")
    if consistency < 1.0:
        issues.append(f"amount consistency {(consistency * 100):.0f}% (total vs quantity x unit_price)")

    return {
        "file": file_name,
        "row_count": int(len(df)),
        "columns": columns,
        "quality": {
            "completeness": round(completeness, 3),
            "validity": round(validity, 3),
            "consistency": round(consistency, 3),
            "duplicates": dup_count,
            "score": score,
            "issues": issues,
        },
    }


def numeric_view(rows: list[dict], columns: list[str]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    for col in columns:
        df[col] = pd.to_numeric(df.get(col), errors="coerce")
    return df


def parse_date(value: str) -> datetime | None:
    try:
        return pd.to_datetime(str(value), format="mixed", errors="coerce").to_pydatetime()
    except Exception:  # noqa: BLE001
        return None
