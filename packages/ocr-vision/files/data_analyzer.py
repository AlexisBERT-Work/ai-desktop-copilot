"""Tabular data analysis (CSV/Excel) using pandas.

Exposes a declarative analyzer — no arbitrary code execution. Two operations:
- profile   : structure + summary stats (default)
- aggregate : group_by + an aggregation function on a column
"""

import logging
import math
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)

AGG_FUNCS = {"sum", "mean", "median", "min", "max", "count", "std", "nunique"}


def _native(value: Any) -> Any:
    """Coerce numpy/pandas scalars to JSON-serializable natives; NaN -> None."""
    if value is None:
        return None
    if hasattr(value, "item"):
        try:
            value = value.item()
        except Exception:
            pass
    if isinstance(value, float) and math.isnan(value):
        return None
    return value


def _load_dataframe(path: str, sheet: Optional[str], max_rows: int):
    import pandas as pd

    lower = path.lower()
    if lower.endswith(".csv"):
        df = pd.read_csv(path)
    elif lower.endswith((".xlsx", ".xlsm", ".xls")):
        df = pd.read_excel(path, sheet_name=sheet if sheet else 0)
    else:
        raise ValueError("Unsupported file type. Use .csv, .xlsx or .xls")

    total_rows = len(df)
    truncated = bool(max_rows) and total_rows > max_rows
    if truncated:
        df = df.head(max_rows)
    return df, total_rows, truncated


def _profile(df, total_rows: int, truncated: bool) -> Dict[str, Any]:
    import pandas as pd

    columns: List[Dict[str, Any]] = []
    for name in df.columns:
        col = df[name]
        columns.append(
            {
                "name": str(name),
                "dtype": str(col.dtype),
                "nonNull": int(col.notna().sum()),
                "nullCount": int(col.isna().sum()),
                "unique": int(col.nunique(dropna=True)),
            }
        )

    numeric_summary: Dict[str, Any] = {}
    numeric_cols = df.select_dtypes(include="number")
    if not numeric_cols.empty:
        desc = numeric_cols.describe().to_dict()
        numeric_summary = {
            str(col): {str(stat): _native(val) for stat, val in stats.items()}
            for col, stats in desc.items()
        }

    categorical_top: Dict[str, Any] = {}
    for name in df.select_dtypes(include=["object", "category", "bool"]).columns:
        counts = df[name].value_counts(dropna=True).head(5)
        categorical_top[str(name)] = [
            {"value": _native(idx), "count": int(cnt)} for idx, cnt in counts.items()
        ]

    preview = [
        {str(k): _native(v) for k, v in row.items()}
        for row in df.head(10).to_dict(orient="records")
    ]

    return {
        "operation": "profile",
        "rows": total_rows,
        "rowsAnalyzed": int(len(df)),
        "columns": int(df.shape[1]),
        "truncated": truncated,
        "columnInfo": columns,
        "numericSummary": numeric_summary,
        "categoricalTop": categorical_top,
        "preview": preview,
    }


def _aggregate(
    df,
    total_rows: int,
    truncated: bool,
    group_by: List[str],
    value_column: Optional[str],
    agg: str,
) -> Dict[str, Any]:
    if agg not in AGG_FUNCS:
        raise ValueError(f"Unknown agg '{agg}'. Allowed: {sorted(AGG_FUNCS)}")

    missing = [c for c in group_by if c not in df.columns]
    if missing:
        raise ValueError(f"group_by column(s) not found: {missing}. Available: {list(map(str, df.columns))}")

    if agg == "count" and not value_column:
        grouped = df.groupby(group_by, dropna=False).size().reset_index(name="count")
        result_label = "count"
    else:
        if not value_column:
            raise ValueError("value_column is required unless agg='count'")
        if value_column not in df.columns:
            raise ValueError(f"value_column '{value_column}' not found. Available: {list(map(str, df.columns))}")
        series = df.groupby(group_by, dropna=False)[value_column].agg(agg)
        result_label = f"{value_column}_{agg}"
        grouped = series.reset_index(name=result_label)

    # Sort by the aggregated value descending when numeric, cap output.
    try:
        grouped = grouped.sort_values(result_label, ascending=False)
    except Exception:
        pass

    records = [
        {str(k): _native(v) for k, v in row.items()}
        for row in grouped.head(200).to_dict(orient="records")
    ]

    return {
        "operation": "aggregate",
        "rows": total_rows,
        "truncated": truncated,
        "groupBy": group_by,
        "valueColumn": value_column,
        "agg": agg,
        "resultColumn": result_label,
        "groups": int(len(grouped)),
        "result": records,
        "resultTruncated": len(grouped) > 200,
    }


def analyze_dataframe(
    path: str,
    operation: str = "profile",
    sheet: Optional[str] = None,
    max_rows: int = 100_000,
    group_by: Optional[List[str]] = None,
    value_column: Optional[str] = None,
    agg: str = "sum",
) -> Dict[str, Any]:
    try:
        import pandas  # noqa: F401
    except ImportError:
        raise RuntimeError("pandas not installed. Run: pip install pandas openpyxl")

    df, total_rows, truncated = _load_dataframe(path, sheet, max_rows)

    if operation == "profile":
        return _profile(df, total_rows, truncated)
    if operation == "aggregate":
        return _aggregate(df, total_rows, truncated, group_by or [], value_column, agg)
    raise ValueError(f"Unknown operation '{operation}'. Use 'profile' or 'aggregate'.")
