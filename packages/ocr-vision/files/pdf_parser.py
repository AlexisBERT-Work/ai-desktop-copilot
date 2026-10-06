"""PDF file parser using pypdf"""

from typing import Dict, Any
from deps import require


def parse_pdf_file(path: str, max_pages: int = 50) -> Dict[str, Any]:
    PdfReader = require("pypdf").PdfReader

    reader = PdfReader(path)
    total_pages = len(reader.pages)
    pages_to_read = min(total_pages, max_pages)

    text_parts = []
    for i in range(pages_to_read):
        page = reader.pages[i]
        text = page.extract_text() or ""
        text_parts.append(f"--- Page {i + 1} ---\n{text}")

    metadata = reader.metadata or {}

    return {
        "text": "\n\n".join(text_parts),
        "totalPages": total_pages,
        "pagesRead": pages_to_read,
        "truncated": total_pages > max_pages,
        "metadata": {
            "title": str(metadata.get("/Title", "")),
            "author": str(metadata.get("/Author", "")),
            "subject": str(metadata.get("/Subject", "")),
        },
    }
