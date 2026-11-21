"""Ce qu'un fichier révèle avant d'être partagé (veille du 16/11).

Lecture seule : rien n'est modifié, aucune copie n'est écrite. On liste ce qui
voyage avec le fichier sans se voir à l'écran :

- photos (JPEG, PNG, TIFF, WebP) : position GPS, appareil, date de prise de
  vue, logiciel, champs texte des PNG (dont les invites d'images générées) ;
- PDF : auteur et logiciel, historique XMP, commentaires, pièces jointes,
  champs de formulaire remplis, révisions incrémentales (une ancienne version
  du fichier reste lisible sous la dernière), texte recouvert d'un rectangle
  noir et caviardages laissés en annotation (le texte dessous est intact) ;
- Word, Excel, PowerPoint (OOXML) : auteur, dernier modificateur, société,
  modèle et chemin du poste, temps d'édition, commentaires et leurs auteurs,
  suivi des modifications, texte masqué, feuilles et diapos masquées, notes
  de l'orateur, objets incorporés, liaisons vers d'autres fichiers, photos
  incorporées avec GPS ;
- OpenDocument : auteurs, cycles et durée d'édition, commentaires, suivi des
  modifications, photos incorporées.

L'idée vient de unredact.tools (licence non déclarée : rien n'en est repris,
seulement la liste de ce qu'il cherche). Le rectangle noir n'est cherché que
dans les tracés du PDF : un scan noirci dans l'image demanderait l'OCR, pas
fait ici.

Sortie courte (le modèle la relit) : 30 constats au plus, 200 caractères par
détail, des noms et des nombres plutôt que le contenu des commentaires.
"""

from __future__ import annotations

import io
import os
import re
import zipfile
from typing import Any, Dict, Iterable, List, Optional
from xml.etree import ElementTree as ET

from deps import require

MAX_FINDINGS = 30
MAX_DETAIL = 200
MAX_MEMBER_BYTES = 30_000_000
MAX_MEDIA_FILES = 20
MAX_PDF_PAGES = 300
MAX_COVER_PAGES = 100  # pages relues à la recherche d'un texte recouvert
MAX_SCAN_BYTES = 200_000_000

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}
OOXML_EXT = {".docx", ".docm", ".xlsx", ".xlsm", ".pptx", ".pptm"}
ODF_EXT = {".odt", ".ods", ".odp"}
SUPPORTED = sorted(IMAGE_EXT | OOXML_EXT | ODF_EXT | {".pdf"})

HIGH, MEDIUM, INFO = "élevé", "moyen", "info"
_ORDER = {HIGH: 0, MEDIUM: 1, INFO: 2}

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "w15": "http://schemas.microsoft.com/office/word/2012/wordml",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "cp": "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
    "dc": "http://purl.org/dc/elements/1.1/",
    "dcterms": "http://purl.org/dc/terms/",
    "ep": "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
    "x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
    "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
    "meta": "urn:oasis:names:tc:opendocument:xmlns:meta:1.0",
}

# Chemins qui trahissent un poste ou un nom d'utilisateur.
_USER_PATH = re.compile(
    r"(?:[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\\/:*?\"<>|\r\n]+"
    r"|\\\\[A-Za-z0-9._-]+\\[^\s\"<>|]+"
    r"|/(?:Users|home)/[A-Za-z0-9._-]+)",
)


def _q(prefix: str, local: str) -> str:
    return f"{{{NS[prefix]}}}{local}"


def _clip(text: str, max_len: int = MAX_DETAIL) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= max_len else text[: max_len - 1].rstrip() + "…"


def _names(values: Iterable[str], max_names: int = 5) -> str:
    unique: List[str] = []
    for v in values:
        v = (v or "").strip()
        if v and v not in unique:
            unique.append(v)
    shown = ", ".join(unique[:max_names])
    return shown + (f" et {len(unique) - max_names} autres" if len(unique) > max_names else "")


class _Findings:
    def __init__(self) -> None:
        self.items: List[Dict[str, str]] = []

    def add(self, level: str, what: str, detail: str = "") -> None:
        item = {"niveau": level, "quoi": what}
        if detail:
            item["detail"] = _clip(detail)
        if item not in self.items:
            self.items.append(item)

    def paths(self, source: str, text: str) -> None:
        found = sorted({m.group(0).rstrip(".,;)") for m in _USER_PATH.finditer(text or "")})
        if found:
            self.add(HIGH, f"Chemin du poste ({source})", _names(found, 3))

    def result(self) -> List[Dict[str, str]]:
        ordered = sorted(self.items, key=lambda i: _ORDER.get(i["niveau"], 3))
        return ordered[:MAX_FINDINGS]


# ─── Photos ───────────────────────────────────────────────────


def _gps_degrees(values: Any, ref: Any) -> Optional[float]:
    try:
        d, m, s = (float(v) for v in values)
    except (TypeError, ValueError):
        return None
    deg = d + m / 60 + s / 3600
    return -deg if str(ref).upper() in ("S", "W") else deg


def _inspect_image_bytes(data: bytes, findings: _Findings, label: str = "") -> None:
    # Le sous-module, pas le paquet : `import PIL` ne charge pas `PIL.Image`.
    Image = require("PIL.Image", extra="pillow")
    prefix = f"{label} : " if label else ""
    try:
        with Image.open(io.BytesIO(data)) as im:
            exif = im.getexif()
            info = dict(im.info)
    except Exception:
        return
    gps = exif.get_ifd(0x8825) if exif else {}
    if gps:
        lat = _gps_degrees(gps.get(2), gps.get(1))
        lon = _gps_degrees(gps.get(4), gps.get(3))
        where = f"{lat:.5f}, {lon:.5f}" if lat is not None and lon is not None else "présente"
        findings.add(HIGH, f"{prefix}Position GPS", f"{where} (lieu de la prise de vue)")
    if exif:
        make, model = exif.get(0x010F), exif.get(0x0110)
        if make or model:
            findings.add(MEDIUM, f"{prefix}Appareil", _names([f"{make or ''} {model or ''}"]))
        sub = exif.get_ifd(0x8769)
        taken = sub.get(0x9003) if sub else None
        if taken:
            findings.add(MEDIUM, f"{prefix}Date de prise de vue", str(taken))
        serial = sub.get(0xA431) if sub else None
        if serial:
            findings.add(MEDIUM, f"{prefix}Numéro de série de l'appareil", str(serial))
        for tag, what in ((0x013B, "Auteur"), (0x8298, "Copyright")):
            if exif.get(tag):
                findings.add(MEDIUM, f"{prefix}{what}", str(exif.get(tag)))
        if exif.get(0x0131):
            findings.add(INFO, f"{prefix}Logiciel", str(exif.get(0x0131)))
    # Champs texte des PNG (Author, Comment, et les invites des générateurs d'images).
    text_keys = [k for k, v in info.items() if isinstance(v, str) and k not in ("dpi", "gamma")]
    prompts = [k for k in text_keys if k.lower() in ("parameters", "prompt", "workflow")]
    if prompts:
        findings.add(HIGH, f"{prefix}Invite de génération d'image", _names(prompts))
    others = [k for k in text_keys if k not in prompts and k not in ("exif", "icc_profile", "xmp")]
    if others:
        findings.add(MEDIUM, f"{prefix}Champs texte", _names(others))
    comment = info.get("comment")
    if isinstance(comment, bytes) and comment.strip():
        findings.add(MEDIUM, f"{prefix}Commentaire", comment.decode("utf-8", "replace"))
    xmp = info.get("xmp") or info.get("XML:com.adobe.xmp")
    if xmp:
        findings.paths("XMP", xmp.decode("utf-8", "replace") if isinstance(xmp, bytes) else str(xmp))


def _inspect_image(path: str, findings: _Findings) -> None:
    with open(path, "rb") as handle:
        _inspect_image_bytes(handle.read(MAX_SCAN_BYTES), findings)


# ─── PDF ──────────────────────────────────────────────────────

_ANNOT_TYPES = {
    "/Text", "/FreeText", "/Highlight", "/Underline", "/StrikeOut", "/Squiggly",
    "/Ink", "/Stamp", "/Caret", "/FileAttachment", "/Sound",
}


_PDF_EVENT = re.compile(rb"%%EOF|\d+\s+\d+\s+obj\b")


def _pdf_revisions(path: str) -> int:
    """Nombre de mises à jour incrémentales (révisions empilées). Seule compte une
    mise à jour qui ajoute des objets : Word ajoute une section vide derrière
    chaque export (« xref 0 0 » + /XRefStm, fichier à référence hybride), et la
    première partie d'un fichier linéarisé n'est pas une révision."""
    sections: List[bool] = []  # pour chaque %%EOF : des objets depuis le précédent ?
    objects = False
    linearized = False
    tail = b""
    read = 0
    with open(path, "rb") as handle:
        while read < MAX_SCAN_BYTES:
            chunk = handle.read(1 << 20)
            if not chunk:
                break
            if read == 0:
                linearized = b"/Linearized" in chunk[:2048]
            block = tail + chunk
            for match in _PDF_EVENT.finditer(block):
                if match.end() <= len(tail):  # déjà vu dans le bloc précédent
                    continue
                if match.group(0) == b"%%EOF":
                    sections.append(objects)
                    objects = False
                else:
                    objects = True
            tail = block[-32:]
            read += len(chunk)
    updates = sections[2:] if linearized else sections[1:]
    return sum(1 for added in updates if added)


_FILL_OPS = {b"f", b"F", b"f*", b"B", b"B*", b"b", b"b*"}
_END_PATH_OPS = {b"n", b"S", b"s"}
_TEXT_OPS = {b"Tj", b"TJ", b"'", b'"'}


def _is_dark(values: List[float]) -> bool:
    """Couleur de remplissage assez sombre pour cacher un texte noir."""
    if len(values) == 1:  # gris
        return values[0] <= 0.15
    if len(values) == 3:  # RVB
        return max(values) <= 0.15
    if len(values) == 4:  # CMJN
        return values[3] >= 0.85 or min(values[:3]) >= 0.85
    return False


def _apply(cm: Any, x: float, y: float) -> tuple:
    return cm[0] * x + cm[2] * y + cm[4], cm[1] * x + cm[3] * y + cm[5]


class _CoverScan:
    """Repère le texte qu'un rectangle sombre recouvre : invisible à l'écran,
    mais copiable et lu par n'importe quel extracteur (le caviardage raté par
    excellence). Compte le texte sous un rectangle peint après lui, ou un texte
    sombre peint sur un rectangle sombre. Un texte clair sur fond sombre (en-tête
    de tableau) reste lisible : il ne compte pas. Tracés vectoriels seulement :
    un scan caviardé dans l'image n'a pas de texte à trouver ici."""

    def __init__(self) -> None:
        self.fill: List[float] = [0.0]
        self.saved: List[List[float]] = []
        self.path: List[tuple] = []
        self.rects: List[tuple] = []  # (étape, x0, y0, x1, y1)
        self.texts: List[tuple] = []  # (étape, x, y, texte sombre)
        self.step = 0

    def __call__(self, op: bytes, args: Any, cm: Any, tm: Any) -> None:
        self.step += 1
        if op == b"q":
            self.saved.append(self.fill)
        elif op == b"Q":
            if self.saved:
                self.fill = self.saved.pop()
        elif op in (b"g", b"rg", b"k", b"sc", b"scn"):
            numbers = [float(a) for a in args if isinstance(a, (int, float))]
            if numbers:
                self.fill = numbers
        elif op == b"re" and len(args) == 4:
            x, y, w, h = (float(a) for a in args)
            corners = [_apply(cm, x + dx, y + dy) for dx in (0, w) for dy in (0, h)]
            xs, ys = [c[0] for c in corners], [c[1] for c in corners]
            self.path.append((min(xs), min(ys), max(xs), max(ys)))
        elif op in _FILL_OPS:
            if _is_dark(self.fill):
                self.rects.extend((self.step, *box) for box in self.path)
            self.path = []
        elif op in _END_PATH_OPS:
            self.path = []
        elif op in _TEXT_OPS and args:
            x, y = _apply(cm, float(tm[4]), float(tm[5]))
            self.texts.append((self.step, x, y, _is_dark(self.fill)))

    def covered_lines(self) -> int:
        """Lignes (même hauteur) qui ont au moins un morceau de texte recouvert."""
        lines = set()
        for t_step, x, y, dark_text in self.texts:
            for r_step, x0, y0, x1, y1 in self.rects:
                inside = x0 - 1 <= x <= x1 + 1 and y0 - 1 <= y <= y1 + 1
                if inside and (r_step > t_step or dark_text):
                    lines.add(round(y))
                    break
        return len(lines)


def _inspect_pdf(path: str, findings: _Findings) -> None:
    pypdf = require("pypdf")
    reader = pypdf.PdfReader(path)
    if reader.is_encrypted:
        findings.add(INFO, "PDF chiffré", "métadonnées internes illisibles sans le mot de passe")
        return
    meta = reader.metadata or {}
    for key, what, level in (
        ("/Author", "Auteur", MEDIUM),
        ("/Creator", "Logiciel de création", INFO),
        ("/Producer", "Producteur", INFO),
        ("/Title", "Titre interne", INFO),
        ("/Subject", "Sujet", INFO),
        ("/Keywords", "Mots-clés", INFO),
    ):
        value = meta.get(key)
        if value and str(value).strip():
            findings.add(level, what, str(value))
            findings.paths(what.lower(), str(value))
    revisions = _pdf_revisions(path)
    if revisions:
        findings.add(
            HIGH,
            "Révisions incrémentales",
            f"{revisions} version(s) antérieure(s) empilée(s) sous la dernière : "
            "un texte retiré ou caviardé après coup peut s'y lire encore",
        )
    try:
        root = reader.trailer["/Root"]
        metadata_stream = root.get("/Metadata")
        if metadata_stream is not None:
            xmp = metadata_stream.get_object().get_data()[:2_000_000].decode("utf-8", "replace")
            if "stEvt:" in xmp or "xmpMM:History" in xmp:
                findings.add(MEDIUM, "Historique d'édition (XMP)", "logiciels et dates des enregistrements")
            findings.paths("XMP", xmp)
    except Exception:
        pass
    authors: List[str] = []
    count = 0
    removable = 0
    covered = 0
    covered_pages: List[str] = []
    for number, page in enumerate(reader.pages[:MAX_PDF_PAGES], start=1):
        for ref in page.get("/Annots") or []:
            try:
                annot = ref.get_object()
            except Exception:
                continue
            subtype = annot.get("/Subtype")
            if subtype in _ANNOT_TYPES:
                count += 1
                if annot.get("/T"):
                    authors.append(str(annot.get("/T")))
            # Caviardage marqué mais pas appliqué, ou carré noir posé en
            # annotation : le texte dessous est intact, l'annotation s'ôte d'un clic.
            interior = [float(v) for v in annot.get("/IC") or [] if isinstance(v, (int, float))]
            if subtype == "/Redact" or (subtype == "/Square" and _is_dark(interior)):
                removable += 1
        if number <= MAX_COVER_PAGES:
            scan = _CoverScan()
            try:
                page.extract_text(visitor_operand_before=scan)
            except Exception:
                continue
            hidden = scan.covered_lines()
            if hidden:
                covered += hidden
                covered_pages.append(str(number))
    if covered:
        findings.add(
            HIGH,
            "Texte sous un rectangle noir",
            f"{covered} ligne(s) recouverte(s), page(s) {_names(covered_pages)} : "
            "invisible à l'écran, mais copiable et lisible par un extracteur",
        )
    if removable:
        findings.add(
            HIGH,
            "Caviardage réversible",
            f"{removable} zone(s) noircie(s) par annotation : le texte dessous est intact",
        )
    if count:
        detail = f"{count} annotation(s)" + (f" de {_names(authors)}" if authors else "")
        findings.add(HIGH, "Commentaires et annotations", detail)
    try:
        attachments = list(reader.attachments.keys())
    except Exception:
        attachments = []
    if attachments:
        findings.add(HIGH, "Pièces jointes incorporées", _names(attachments))
    try:
        fields = reader.get_fields() or {}
    except Exception:
        fields = {}
    filled = [name for name, f in fields.items() if f.get("/V") not in (None, "", "/Off")]
    if filled:
        findings.add(MEDIUM, "Champs de formulaire remplis", f"{len(filled)} : {_names(filled)}")


# ─── Archives zip (OOXML, ODF) ────────────────────────────────


def _open_zip(path: str) -> zipfile.ZipFile:
    try:
        return zipfile.ZipFile(path)
    except zipfile.BadZipFile as exc:
        raise ValueError(
            "Fichier illisible : corrompu, ou protégé par un mot de passe (chiffré, il n'est "
            "plus une archive zip, et ses métadonnées sont cachées avec le reste)."
        ) from exc


def _member(zf: zipfile.ZipFile, name: str) -> Optional[bytes]:
    try:
        info = zf.getinfo(name)
    except KeyError:
        return None
    if info.file_size > MAX_MEMBER_BYTES:
        raise ValueError(f"Membre {name} trop volumineux une fois décompressé.")
    with zf.open(info) as handle:
        return handle.read(MAX_MEMBER_BYTES + 1)


def _xml(zf: zipfile.ZipFile, name: str) -> Optional[ET.Element]:
    data = _member(zf, name)
    if data is None:
        return None
    try:
        return ET.fromstring(data)
    except ET.ParseError:
        return None


def _text_of(root: Optional[ET.Element], tag: str) -> str:
    if root is None:
        return ""
    el = root.find(tag, NS)
    return el.text.strip() if el is not None and el.text else ""


def _inspect_media(zf: zipfile.ZipFile, folder_prefixes: Iterable[str], findings: _Findings) -> None:
    media = [
        n for n in zf.namelist()
        if any(n.startswith(p) for p in folder_prefixes)
        and os.path.splitext(n)[1].lower() in IMAGE_EXT
    ]
    for name in media[:MAX_MEDIA_FILES]:
        data = _member(zf, name)
        if data:
            _inspect_image_bytes(data, findings, label=f"Image incorporée {posix_basename(name)}")


def posix_basename(name: str) -> str:
    return name.rsplit("/", 1)[-1]


def _inspect_ooxml(path: str, findings: _Findings) -> None:
    with _open_zip(path) as zf:
        names = zf.namelist()
        core = _xml(zf, "docProps/core.xml")
        author = _text_of(core, "dc:creator")
        modifier = _text_of(core, "cp:lastModifiedBy")
        if author or modifier:
            findings.add(MEDIUM, "Auteurs", _names([author, modifier]))
        revision = _text_of(core, "cp:revision")
        if revision.isdigit() and int(revision) > 1:
            findings.add(INFO, "Enregistrements", f"{revision} révisions")
        app = _xml(zf, "docProps/app.xml")
        for tag, what, level in (
            ("ep:Company", "Société", MEDIUM),
            ("ep:Manager", "Responsable", MEDIUM),
            ("ep:Template", "Modèle", INFO),
            ("ep:Application", "Logiciel", INFO),
        ):
            value = _text_of(app, tag)
            if value:
                findings.add(level, what, value)
                findings.paths(what.lower(), value)
        total = _text_of(app, "ep:TotalTime")
        if total.isdigit() and int(total) > 0:
            findings.add(INFO, "Temps d'édition", f"{total} minutes")
        custom = _xml(zf, "docProps/custom.xml")
        if custom is not None and len(custom):
            props = [p.get("name", "") for p in custom]
            findings.add(MEDIUM, "Propriétés personnalisées", _names(props))

        # Commentaires et leurs auteurs.
        authors: List[str] = []
        comments = 0
        for name in names:
            if name in ("word/comments.xml",) or re.fullmatch(r"xl/comments\d*\.xml", name):
                root = _xml(zf, name)
                if root is None:
                    continue
                if name.startswith("word/"):
                    for c in root.iter(_q("w", "comment")):
                        comments += 1
                        authors.append(c.get(_q("w", "author"), ""))
                else:
                    comments += sum(1 for _ in root.iter(_q("x", "comment")))
                    authors += [a.text or "" for a in root.iter(_q("x", "author"))]
            elif re.fullmatch(r"ppt/comments/[^/]+\.xml", name) or re.fullmatch(
                r"xl/threadedComments/[^/]+\.xml", name
            ):
                root = _xml(zf, name)
                comments += len(list(root)) if root is not None else 0
        cm_authors = _xml(zf, "ppt/commentAuthors.xml")
        if cm_authors is not None:
            authors += [a.get("name", "") for a in cm_authors]
        for name in names:
            # Auteurs des commentaires modernes (Excel, PowerPoint) : attribut displayName.
            if re.fullmatch(r"(xl/persons|ppt/authors)[^/]*(/[^/]+)?\.xml", name):
                root = _xml(zf, name)
                if root is not None:
                    authors += [el.get("displayName", "") for el in root.iter() if el.get("displayName")]
        people = _xml(zf, "word/people.xml")
        if people is not None:
            authors += [p.get(_q("w15", "author"), "") for p in people]
        if comments:
            findings.add(HIGH, "Commentaires", f"{comments}" + (f" de {_names(authors)}" if authors else ""))
        elif authors:
            findings.add(MEDIUM, "Personnes citées par le fichier", _names(authors))

        # Suivi des modifications et texte masqué (Word).
        changes = 0
        change_authors: List[str] = []
        hidden = 0
        for name in names:
            if re.fullmatch(r"word/(document|header\d*|footer\d*|footnotes|endnotes)\.xml", name):
                root = _xml(zf, name)
                if root is None:
                    continue
                for tag in ("ins", "del", "moveFrom", "moveTo"):
                    for el in root.iter(_q("w", tag)):
                        changes += 1
                        change_authors.append(el.get(_q("w", "author"), ""))
                hidden += sum(1 for _ in root.iter(_q("w", "vanish")))
        if changes:
            findings.add(
                HIGH,
                "Suivi des modifications",
                f"{changes} modification(s) non acceptée(s) de {_names(change_authors)} : "
                "le texte supprimé reste dans le fichier",
            )
        if hidden:
            findings.add(HIGH, "Texte masqué", f"{hidden} passage(s) en texte invisible")

        # Excel : feuilles masquées, liaisons externes.
        workbook = _xml(zf, "xl/workbook.xml")
        if workbook is not None:
            masked = [
                s.get("name", "")
                for s in workbook.iter(_q("x", "sheet"))
                if s.get("state") in ("hidden", "veryHidden")
            ]
            if masked:
                findings.add(HIGH, "Feuilles masquées", _names(masked))
        links = [n for n in names if re.fullmatch(r"xl/externalLinks/externalLink\d+\.xml", n)]
        if links:
            findings.add(MEDIUM, "Liaisons vers d'autres classeurs", f"{len(links)}")

        # PowerPoint : diapos masquées, notes de l'orateur.
        slides = [n for n in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)]
        masked_slides = 0
        for name in slides:
            root = _xml(zf, name)
            if root is not None and root.get("show") == "0":
                masked_slides += 1
        if masked_slides:
            findings.add(HIGH, "Diapos masquées", f"{masked_slides} sur {len(slides)}")
        notes = [n for n in names if re.fullmatch(r"ppt/notesSlides/notesSlide\d+\.xml", n)]
        if notes:
            findings.add(MEDIUM, "Notes de l'orateur", f"sur {len(notes)} diapo(s)")

        # Objets incorporés, macros, chemins dans les relations.
        embedded = [posix_basename(n) for n in names if re.match(r"(word|xl|ppt)/embeddings/", n)]
        if embedded:
            findings.add(HIGH, "Fichiers incorporés", _names(embedded))
        if any(n.endswith("vbaProject.bin") for n in names):
            findings.add(INFO, "Macros", "le fichier contient du code VBA")
        # Modèle attaché, liaison OLE, image liée : une relation externe qui n'est
        # pas un lien web pointe vers un fichier du poste ou du réseau.
        for name in names:
            if not name.endswith(".rels"):
                continue
            root = _xml(zf, name)
            if root is None:
                continue
            for rel in root.findall("rel:Relationship", NS):
                target = rel.get("Target", "")
                if rel.get("TargetMode") == "External" and not target.lower().startswith(
                    ("http://", "https://", "mailto:")
                ):
                    findings.add(HIGH, "Lien vers un fichier du poste", target)

        _inspect_media(zf, ("word/media/", "xl/media/", "ppt/media/"), findings)


def _inspect_odf(path: str, findings: _Findings) -> None:
    with _open_zip(path) as zf:
        meta_root = _xml(zf, "meta.xml")
        meta = meta_root.find("office:meta", NS) if meta_root is not None else None
        if meta is not None:
            authors = [_text_of(meta, "meta:initial-creator"), _text_of(meta, "dc:creator")]
            if any(authors):
                findings.add(MEDIUM, "Auteurs", _names(authors))
            cycles = _text_of(meta, "meta:editing-cycles")
            if cycles.isdigit() and int(cycles) > 1:
                findings.add(INFO, "Enregistrements", f"{cycles} cycles d'édition")
            duration = _text_of(meta, "meta:editing-duration")
            if duration:
                findings.add(INFO, "Temps d'édition", duration)
            generator = _text_of(meta, "meta:generator")
            if generator:
                findings.add(INFO, "Logiciel", generator)
            fields = [f.get(_q("meta", "name"), "") for f in meta.iter(_q("meta", "user-defined"))]
            if fields:
                findings.add(MEDIUM, "Propriétés personnalisées", _names(fields))
            findings.paths("métadonnées", ET.tostring(meta, encoding="unicode"))
        content = _xml(zf, "content.xml")
        if content is not None:
            notes = list(content.iter(_q("office", "annotation")))
            if notes:
                authors = [_text_of(n, "dc:creator") for n in notes]
                findings.add(HIGH, "Commentaires", f"{len(notes)}" + (f" de {_names(authors)}" if any(authors) else ""))
            regions = list(content.iter(_q("text", "changed-region")))
            if regions:
                authors = [c.text or "" for r in regions for c in r.iter(_q("dc", "creator"))]
                findings.add(
                    HIGH,
                    "Suivi des modifications",
                    f"{len(regions)} modification(s) de {_names(authors)} : le texte supprimé reste dans le fichier",
                )
            hidden = sum(1 for _ in content.iter(_q("text", "hidden-paragraph"))) + sum(
                1 for _ in content.iter(_q("text", "hidden-text"))
            )
            if hidden:
                findings.add(HIGH, "Texte masqué", f"{hidden} passage(s)")
        embedded = [n for n in zf.namelist() if n.startswith("Object ") and n.endswith("/content.xml")]
        if embedded:
            findings.add(HIGH, "Objets incorporés", f"{len(embedded)}")
        _inspect_media(zf, ("Pictures/",), findings)


# ─── Point d'entrée ───────────────────────────────────────────


def inspect_file_leaks(path: str) -> Dict[str, Any]:
    ext = os.path.splitext(path)[1].lower()
    if ext not in SUPPORTED:
        raise ValueError(f"Format non inspecté : {ext or 'sans extension'}. Acceptés : {', '.join(SUPPORTED)}")
    if not os.path.isfile(path):
        raise FileNotFoundError(f"No such file: {path}")
    findings = _Findings()
    if ext in IMAGE_EXT:
        _inspect_image(path, findings)
    elif ext == ".pdf":
        _inspect_pdf(path, findings)
    elif ext in OOXML_EXT:
        _inspect_ooxml(path, findings)
    else:
        _inspect_odf(path, findings)
    items = findings.result()
    high = sum(1 for i in items if i["niveau"] == HIGH)
    summary = (
        "Rien de caché repéré dans ce qui est inspecté."
        if not items
        else f"{len(items)} point(s) à vérifier, dont {high} élevé(s)."
    )
    return {
        "fichier": os.path.basename(path),
        "format": ext.lstrip("."),
        "resume": summary,
        "constats": items,
        "nonVerifie": "contenu visible des pages, texte dans les images (scans noircis)",
    }
