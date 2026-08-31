"""CSV file parser"""

import csv
from typing import Dict, Any

from deps import require


def parse_csv_file(path: str, max_rows: int = 1000) -> Dict[str, Any]:
    chardet = require("chardet")
    # Detect encoding
    with open(path, "rb") as f:
        raw = f.read(50_000)
        detected = chardet.detect(raw)
        encoding = detected.get("encoding") or "utf-8"

    rows = []
    with open(path, encoding=encoding, errors="replace") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames or []
        for i, row in enumerate(reader):
            if i >= max_rows:
                break
            rows.append(dict(row))

    # Convert to readable text summary
    text_rows = [",".join(headers)]
    for row in rows[:50]:  # Preview first 50 rows in text
        text_rows.append(",".join(str(v) for v in row.values()))

    return {
        "headers": list(headers),
        "rows": rows,
        "rowCount": len(rows),
        "text": "\n".join(text_rows),
        "truncated": len(rows) >= max_rows,
        "encoding": encoding,
    }
