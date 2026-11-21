"""PDF file parser using pypdf"""

from typing import Dict, Any
from deps import require


def parse_pdf_file(path: str, max_pages: int = 50, start_page: int = 1) -> Dict[str, Any]:
    """Texte des pages start_page à start_page + max_pages - 1 (numérotées à partir de 1).

    start_page permet à l'agent de lire la suite d'un long PDF : sa sortie est
    réduite pour tenir dans la fenêtre du modèle, et les en-têtes de page lui
    disent où elle s'arrête.
    """
    PdfReader = require("pypdf").PdfReader

    reader = PdfReader(path)
    total_pages = len(reader.pages)
    first = max(1, int(start_page))
    last = min(total_pages, first + max(0, int(max_pages)) - 1)

    text_parts = []
    for i in range(first - 1, last):
        page = reader.pages[i]
        text = page.extract_text() or ""
        text_parts.append(f"--- Page {i + 1} ---\n{text}")

    metadata = reader.metadata or {}

    return {
        "text": "\n\n".join(text_parts),
        "totalPages": total_pages,
        "firstPage": first,
        "lastPage": last,
        "pagesRead": max(0, last - first + 1),
        "truncated": last < total_pages,
        "metadata": {
            "title": str(metadata.get("/Title", "")),
            "author": str(metadata.get("/Author", "")),
            "subject": str(metadata.get("/Subject", "")),
        },
    }
