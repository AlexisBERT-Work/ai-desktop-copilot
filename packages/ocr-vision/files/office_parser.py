"""PowerPoint (.pptx), Excel (.xlsx) et OpenDocument (.odt, .ods, .odp).

Veille du 17/11 : elle proposait OpenDocKit. Écarté le 2026-11-21 : dépôt de
10 jours, un seul auteur, 17 versions en 10 jours, Python 3.12 au minimum et
12 dépendances (pypdfium2, pdfplumber, pdfminer…) pour un sidecar qui en a
déjà la moitié. Ces formats sont des archives zip de XML : la bibliothèque
standard suffit pour PPTX et ODF, et openpyxl (déjà là pour `analyze_data`)
lit XLSX. Aucune dépendance ajoutée.

Ce qu'on en retient de la veille :
- `max_chars` ARRÊTE l'extraction au lieu de couper après coup : la sortie
  tient dans le budget de contexte, et un gros fichier ne coûte pas plus cher ;
- chaque diapo, feuille ou page porte un repère (« ## Diapo 3 ») pour citer ;
- `warnings` dit ce qui a été sauté.

Archive hostile : chaque membre XML est plafonné à `MAX_MEMBER_BYTES` décompressés
(bombe zip), et ElementTree ne résout pas les entités externes. Expat (Python
3.12) borne l'expansion d'entités internes.
"""

from __future__ import annotations

import posixpath
import re
import zipfile
from typing import Any, Dict, List, Optional
from xml.etree import ElementTree as ET

from deps import require

DEFAULT_MAX_CHARS = 12_000
MAX_MEMBER_BYTES = 30_000_000
DEFAULT_MAX_ROWS = 200
# Colonnes ou lignes répétées d'ODS (une feuille vide déclare 1 024 colonnes).
MAX_REPEAT = 50

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "cp": "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
    "dc": "http://purl.org/dc/elements/1.1/",
    "dcterms": "http://purl.org/dc/terms/",
    "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
    "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
    "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
    "draw": "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0",
    "meta": "urn:oasis:names:tc:opendocument:xmlns:meta:1.0",
}


def _q(prefix: str, local: str) -> str:
    return f"{{{NS[prefix]}}}{local}"


class _Budget:
    """Texte accumulé jusqu'à `max_chars` ; au-delà, l'extraction s'arrête."""

    def __init__(self, max_chars: int) -> None:
        self.max_chars = max(500, int(max_chars))
        self.parts: List[str] = []
        self.size = 0
        self.full = False

    def add(self, text: str) -> bool:
        """Ajoute un bloc ; renvoie False quand le budget est épuisé."""
        if self.full:
            return False
        text = text.strip()
        if not text:
            return True
        room = self.max_chars - self.size
        if len(text) > room:
            self.parts.append(text[: max(0, room - 1)].rstrip() + "…")
            self.size = self.max_chars
            self.full = True
            return False
        self.parts.append(text)
        self.size += len(text) + 2
        return True

    def text(self) -> str:
        return "\n\n".join(self.parts)


# ─── Archive ──────────────────────────────────────────────────


def _open_zip(path: str, kind: str) -> zipfile.ZipFile:
    try:
        return zipfile.ZipFile(path)
    except zipfile.BadZipFile as exc:
        raise ValueError(
            f"Fichier illisible comme {kind} : corrompu, ou protégé par un mot de passe "
            "(un fichier chiffré n'est plus une archive zip)."
        ) from exc


def _read_xml(zf: zipfile.ZipFile, name: str) -> Optional[ET.Element]:
    try:
        info = zf.getinfo(name)
    except KeyError:
        return None
    if info.file_size > MAX_MEMBER_BYTES:
        raise ValueError(f"Membre {name} trop volumineux une fois décompressé ({info.file_size} octets).")
    with zf.open(info) as handle:
        return ET.fromstring(handle.read(MAX_MEMBER_BYTES + 1))


def _rels(zf: zipfile.ZipFile, part: str) -> Dict[str, Dict[str, str]]:
    """Relations d'une partie OOXML : rId -> {target (chemin absolu dans le zip), type}."""
    folder, file = posixpath.split(part)
    root = _read_xml(zf, posixpath.join(folder, "_rels", file + ".rels"))
    out: Dict[str, Dict[str, str]] = {}
    if root is None:
        return out
    for rel in root.findall("rel:Relationship", NS):
        target = rel.get("Target", "")
        if rel.get("TargetMode") == "External":
            continue
        resolved = posixpath.normpath(posixpath.join(folder, target)).lstrip("/")
        out[rel.get("Id", "")] = {"target": resolved, "type": rel.get("Type", "")}
    return out


def _ooxml_metadata(zf: zipfile.ZipFile) -> Dict[str, str]:
    root = _read_xml(zf, "docProps/core.xml")
    if root is None:
        return {}
    fields = {
        "title": "dc:title",
        "author": "dc:creator",
        "lastModifiedBy": "cp:lastModifiedBy",
        "created": "dcterms:created",
        "modified": "dcterms:modified",
    }
    out: Dict[str, str] = {}
    for key, tag in fields.items():
        el = root.find(tag, NS)
        if el is not None and el.text and el.text.strip():
            out[key] = el.text.strip()
    return out


def _odf_metadata(zf: zipfile.ZipFile) -> Dict[str, str]:
    root = _read_xml(zf, "meta.xml")
    if root is None:
        return {}
    meta = root.find("office:meta", NS)
    if meta is None:
        return {}
    fields = {
        "title": "dc:title",
        "author": "meta:initial-creator",
        "lastModifiedBy": "dc:creator",
        "created": "meta:creation-date",
        "modified": "dc:date",
    }
    out: Dict[str, str] = {}
    for key, tag in fields.items():
        el = meta.find(tag, NS)
        if el is not None and el.text and el.text.strip():
            out[key] = el.text.strip()
    return out


# ─── PowerPoint ───────────────────────────────────────────────

_SLIDE_TYPE = "/relationships/slide"
_NOTES_TYPE = "/relationships/notesSlide"


def _drawing_paragraphs(root: ET.Element) -> List[str]:
    """Paragraphes DrawingML (zones de texte, formes, cellules de tableau), dans l'ordre."""
    lines = []
    for para in root.iter(_q("a", "p")):
        runs = [t.text or "" for t in para.iter(_q("a", "t"))]
        line = "".join(runs).strip()
        if line:
            lines.append(line)
    return lines


def _slide_parts(zf: zipfile.ZipFile) -> List[str]:
    """Diapos dans l'ordre de la présentation (pas celui des noms de fichiers)."""
    pres = _read_xml(zf, "ppt/presentation.xml")
    rels = _rels(zf, "ppt/presentation.xml")
    ordered: List[str] = []
    if pres is not None:
        for sld in pres.iter(_q("p", "sldId")):
            rid = sld.get(_q("r", "id"), "")
            rel = rels.get(rid)
            if rel and rel["type"].endswith(_SLIDE_TYPE):
                ordered.append(rel["target"])
    if ordered:
        return ordered
    # Repli : présentation sans index, ordre numérique des fichiers.
    names = [n for n in zf.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)]
    return sorted(names, key=lambda n: int(re.findall(r"\d+", n)[-1]))


def parse_pptx_file(path: str, max_chars: int = DEFAULT_MAX_CHARS) -> Dict[str, Any]:
    budget = _Budget(max_chars)
    warnings: List[str] = []
    with _open_zip(path, "PowerPoint") as zf:
        slides = _slide_parts(zf)
        read = 0
        for number, part in enumerate(slides, start=1):
            root = _read_xml(zf, part)
            if root is None:
                warnings.append(f"Diapo {number} absente de l'archive.")
                continue
            hidden = " (masquée)" if root.get("show") == "0" else ""
            lines = _drawing_paragraphs(root)
            notes: List[str] = []
            for rel in _rels(zf, part).values():
                if rel["type"].endswith(_NOTES_TYPE):
                    notes_root = _read_xml(zf, rel["target"])
                    if notes_root is not None:
                        # Le numéro de diapo du masque des notes n'est pas du contenu.
                        notes = [l for l in _drawing_paragraphs(notes_root) if not l.isdigit()]
            block = f"## Diapo {number}{hidden}\n" + "\n".join(lines or ["(sans texte)"])
            if notes:
                block += "\nNotes : " + " ".join(notes)
            read = number
            if not budget.add(block):
                break
        metadata = _ooxml_metadata(zf)
    if budget.full and read < len(slides):
        warnings.append(f"Arrêté à la diapo {read} sur {len(slides)} (max_chars).")
    return {
        "text": budget.text(),
        "slideCount": len(slides),
        "slidesRead": read,
        "truncated": budget.full,
        "warnings": warnings,
        "metadata": metadata,
    }


# ─── Excel ────────────────────────────────────────────────────


def _cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).replace("\n", " ").strip()


def parse_xlsx_file(
    path: str, max_chars: int = DEFAULT_MAX_CHARS, max_rows: int = DEFAULT_MAX_ROWS
) -> Dict[str, Any]:
    openpyxl = require("openpyxl")
    budget = _Budget(max_chars)
    warnings: List[str] = []
    try:
        # read_only : lecture en flux, la mémoire ne suit pas la taille du classeur.
        # data_only : la valeur calculée d'une formule, pas la formule.
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    except zipfile.BadZipFile as exc:
        raise ValueError(
            "Fichier illisible comme Excel : corrompu, ou protégé par un mot de passe."
        ) from exc
    sheets: List[Dict[str, Any]] = []
    total_sheets = len(wb.sheetnames)
    try:
        for ws in wb.worksheets:
            hidden = ws.sheet_state != "visible"
            rows_out: List[str] = []
            rows_seen = 0
            for row in ws.iter_rows(values_only=True):
                cells = [_cell(v) for v in row]
                while cells and not cells[-1]:
                    cells.pop()
                if not cells:
                    continue
                rows_seen += 1
                if len(rows_out) < max_rows:
                    rows_out.append(" | ".join(cells))
            sheets.append({"name": ws.title, "rows": rows_seen, "hidden": hidden})
            if rows_seen > len(rows_out):
                warnings.append(
                    f"Feuille « {ws.title} » : {len(rows_out)} lignes lues sur {rows_seen} (max_rows)."
                )
            label = f"## Feuille « {ws.title} »" + (" (masquée)" if hidden else "")
            if not budget.add(label + "\n" + "\n".join(rows_out or ["(vide)"])):
                break
        metadata: Dict[str, str] = {}
        props = wb.properties
        for key, attr in (
            ("title", "title"),
            ("author", "creator"),
            ("lastModifiedBy", "lastModifiedBy"),
            ("created", "created"),
            ("modified", "modified"),
        ):
            value = getattr(props, attr, None)
            if value:
                metadata[key] = value.isoformat() if hasattr(value, "isoformat") else str(value)
    finally:
        wb.close()
    if budget.full and len(sheets) < total_sheets:
        warnings.append(f"Arrêté à la feuille {len(sheets)} sur {total_sheets} (max_chars).")
    return {
        "text": budget.text(),
        "sheetCount": total_sheets,
        "sheets": sheets,
        "truncated": budget.full,
        "warnings": warnings,
        "metadata": metadata,
    }


# ─── OpenDocument ─────────────────────────────────────────────


def _odf_inline(el: ET.Element) -> str:
    """Texte d'un paragraphe ODF : espaces (text:s), tabulations, sauts de ligne, liens."""
    out: List[str] = [el.text or ""]
    for child in el:
        tag = child.tag
        if tag == _q("text", "s"):
            out.append(" " * min(int(child.get(_q("text", "c"), "1") or 1), 20))
        elif tag == _q("text", "tab"):
            out.append("\t")
        elif tag == _q("text", "line-break"):
            out.append("\n")
        elif tag in (_q("text", "note"), _q("office", "annotation")):
            pass  # notes de bas de page et commentaires : hors du fil du texte
        else:
            out.append(_odf_inline(child))
        out.append(child.tail or "")
    return "".join(out)


def _odf_cell_text(cell: ET.Element) -> str:
    return " ".join(
        _odf_inline(p).strip() for p in cell.iter(_q("text", "p")) if _odf_inline(p).strip()
    )


def _odf_table(table: ET.Element, max_rows: int) -> List[str]:
    rows: List[str] = []
    for row in table.iter(_q("table", "table-row")):
        cells: List[str] = []
        for cell in row:
            if cell.tag not in (_q("table", "table-cell"), _q("table", "covered-table-cell")):
                continue
            repeat = min(int(cell.get(_q("table", "number-columns-repeated"), "1") or 1), MAX_REPEAT)
            cells.extend([_odf_cell_text(cell)] * repeat)
        while cells and not cells[-1]:
            cells.pop()
        if not cells:
            continue
        line = " | ".join(cells)
        repeat_rows = min(int(row.get(_q("table", "number-rows-repeated"), "1") or 1), MAX_REPEAT)
        rows.extend([line] * repeat_rows)
        if len(rows) >= max_rows:
            return rows[:max_rows]
    return rows


def _odf_blocks(el: ET.Element, max_rows: int, table_label: str):
    """Titres, paragraphes et tableaux, dans l'ordre du document."""
    for child in el:
        tag = child.tag
        if tag == _q("text", "h"):
            level = int(child.get(_q("text", "outline-level"), "1") or 1)
            yield "#" * min(level + 1, 6) + " " + _odf_inline(child).strip()
        elif tag == _q("text", "p"):
            yield _odf_inline(child)
        elif tag == _q("table", "table"):
            name = child.get(_q("table", "name"), "")
            yield f"## {table_label} « {name} »\n" + "\n".join(
                _odf_table(child, max_rows) or ["(vide)"]
            )
        elif tag == _q("draw", "page"):
            name = child.get(_q("draw", "name"), "")
            lines = [_odf_inline(p).strip() for p in child.iter(_q("text", "p"))]
            yield f"## Diapo « {name} »\n" + "\n".join([l for l in lines if l] or ["(sans texte)"])
        elif tag in (_q("office", "annotation"), _q("text", "tracked-changes")):
            continue  # commentaires et suivi des modifications : pas le texte du document
        else:
            yield from _odf_blocks(child, max_rows, table_label)


def parse_odf_file(
    path: str, max_chars: int = DEFAULT_MAX_CHARS, max_rows: int = DEFAULT_MAX_ROWS
) -> Dict[str, Any]:
    budget = _Budget(max_chars)
    warnings: List[str] = []
    with _open_zip(path, "OpenDocument") as zf:
        mimetype = ""
        if "mimetype" in zf.namelist():
            mimetype = zf.read("mimetype")[:200].decode("ascii", "replace").strip()
        content = _read_xml(zf, "content.xml")
        if content is None:
            raise ValueError("Fichier OpenDocument sans content.xml : corrompu ou chiffré.")
        body = content.find("office:body", NS)
        blocks = 0
        if body is not None:
            label = "Feuille" if "spreadsheet" in mimetype else "Tableau"
            rows = DEFAULT_MAX_ROWS if max_rows <= 0 else max_rows
            for block in _odf_blocks(body, rows, label):
                blocks += 1
                if not budget.add(block):
                    warnings.append("Arrêté avant la fin du document (max_chars).")
                    break
        metadata = _odf_metadata(zf)
    return {
        "text": budget.text(),
        "kind": mimetype.rsplit(".", 1)[-1] if mimetype else "",
        "blocks": blocks,
        "truncated": budget.full,
        "warnings": warnings,
        "metadata": metadata,
    }
