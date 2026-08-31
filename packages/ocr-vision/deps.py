"""Import des dépendances optionnelles du sidecar.

Chaque parseur/moteur repose sur une bibliothèque tierce qui n'est pas toujours
installée (build minimal, venv incomplet). Le garde
`try: import ... except ImportError: raise RuntimeError(...)` était recopié sept
fois, avec trois comportements différents : certains modules levaient un
RuntimeError explicite, d'autres laissaient remonter l'ImportError brut, et
csv_parser importait sans garde du tout — donc plantait à l'import du module
plutôt qu'à l'appel.

`require` unifie les trois : un seul message, actionnable, toujours levé au
moment de l'appel.
"""

from importlib import import_module
from typing import Any

# Nom du paquet pip quand il diffère du nom du module importé.
_PIP_NAMES = {
    "docx": "python-docx",
    "fitz": "pymupdf",
    "PIL": "pillow",
    "pytesseract": "pytesseract",
    "faster_whisper": "faster-whisper",
    "icalendar": "icalendar recurring-ical-events",
    "pandas": "pandas openpyxl",
}


def require(module: str, *, extra: str | None = None) -> Any:
    """Importe `module` ou lève un RuntimeError disant quoi installer."""
    try:
        return import_module(module)
    except ImportError as exc:
        pip = extra or _PIP_NAMES.get(module, module)
        raise RuntimeError(
            f"{module} n'est pas installé. Lance : pip install {pip}"
        ) from exc
