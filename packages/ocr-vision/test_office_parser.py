"""PowerPoint, Excel et OpenDocument : fichiers construits à la volée, sans fixture binaire."""

import zipfile

import pytest

from files import office_parser as office
from main import dispatch

A = office.NS["a"]
P = office.NS["p"]
R = office.NS["r"]
REL = office.NS["rel"]

CORE = (
    '<cp:coreProperties xmlns:cp="{cp}" xmlns:dc="{dc}" xmlns:dcterms="{dcterms}">'
    "<dc:title>Bilan</dc:title><dc:creator>Claire Martin</dc:creator>"
    "<cp:lastModifiedBy>Paul</cp:lastModifiedBy>"
    "<dcterms:created>2026-11-02T09:00:00Z</dcterms:created>"
    "</cp:coreProperties>"
).format(**office.NS)


def _slide(paragraphs, hidden=False):
    show = ' show="0"' if hidden else ""
    body = "".join(
        f"<a:p>{''.join(f'<a:r><a:t>{run}</a:t></a:r>' for run in runs)}</a:p>"
        for runs in paragraphs
    )
    return (
        f'<p:sld xmlns:p="{P}" xmlns:a="{A}"{show}><p:cSld><p:spTree><p:sp><p:txBody>'
        f"{body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>"
    )


def _rels(entries):
    items = "".join(
        f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/{kind}" Target="{target}"/>'
        for rid, kind, target in entries
    )
    return f'<Relationships xmlns="{REL}">{items}</Relationships>'


def make_pptx(path):
    with zipfile.ZipFile(path, "w") as zf:
        # Ordre de la présentation : slide2 PUIS slide1 (déplacée dans PowerPoint).
        zf.writestr(
            "ppt/presentation.xml",
            f'<p:presentation xmlns:p="{P}" xmlns:r="{R}"><p:sldIdLst>'
            f'<p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/>'
            "</p:sldIdLst></p:presentation>",
        )
        zf.writestr(
            "ppt/_rels/presentation.xml.rels",
            _rels([("rId1", "slide", "slides/slide1.xml"), ("rId2", "slide", "slides/slide2.xml")]),
        )
        zf.writestr("ppt/slides/slide1.xml", _slide([["Chiffres ", "clés"], ["CA : 1,2 M€"]], hidden=True))
        zf.writestr("ppt/slides/slide2.xml", _slide([["Bilan 2026"]]))
        zf.writestr(
            "ppt/slides/_rels/slide1.xml.rels",
            _rels([("rId9", "notesSlide", "../notesSlides/notesSlide1.xml")]),
        )
        zf.writestr("ppt/notesSlides/notesSlide1.xml", _slide([["Insister sur l'export"], ["2"]]))
        zf.writestr("docProps/core.xml", CORE)


ODF_NS = (
    'xmlns:office="{office}" xmlns:text="{text}" xmlns:table="{table}" '
    'xmlns:draw="{draw}" xmlns:meta="{meta}" xmlns:dc="{dc}"'
).format(**office.NS)


def make_odf(path, body, mimetype):
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("mimetype", mimetype)
        zf.writestr(
            "content.xml",
            f'<office:document-content {ODF_NS} office:version="1.3"><office:body>{body}'
            "</office:body></office:document-content>",
        )
        zf.writestr(
            "meta.xml",
            f"<office:document-meta {ODF_NS}><office:meta>"
            "<meta:initial-creator>Claire Martin</meta:initial-creator>"
            "<dc:creator>Paul</dc:creator><dc:title>Lettre</dc:title>"
            "</office:meta></office:document-meta>",
        )


def test_pptx_ordre_de_la_presentation_notes_et_metadonnees(tmp_path):
    path = tmp_path / "bilan.pptx"
    make_pptx(path)
    result = office.parse_pptx_file(str(path))
    text = result["text"]
    assert text.index("## Diapo 1\nBilan 2026") < text.index("## Diapo 2 (masquée)")
    assert "Chiffres clés\nCA : 1,2 M€" in text
    assert "Notes : Insister sur l'export" in text
    assert "Notes : Insister sur l'export 2" not in text  # numéro de diapo du masque
    assert result["slideCount"] == 2 and result["truncated"] is False
    assert result["metadata"] == {
        "title": "Bilan",
        "author": "Claire Martin",
        "lastModifiedBy": "Paul",
        "created": "2026-11-02T09:00:00Z",
    }


def test_pptx_sans_index_prend_l_ordre_numerique(tmp_path):
    path = tmp_path / "x.pptx"
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("ppt/slides/slide10.xml", _slide([["dix"]]))
        zf.writestr("ppt/slides/slide2.xml", _slide([["deux"]]))
    text = office.parse_pptx_file(str(path))["text"]
    assert text.index("deux") < text.index("dix")


def test_max_chars_arrete_l_extraction(tmp_path):
    path = tmp_path / "long.pptx"
    with zipfile.ZipFile(path, "w") as zf:
        for i in range(1, 41):
            zf.writestr(f"ppt/slides/slide{i}.xml", _slide([["mot " * 60]]))
    result = office.parse_pptx_file(str(path), max_chars=1_000)
    assert len(result["text"]) <= 1_000
    assert result["truncated"] is True
    assert result["slidesRead"] < 40
    assert any("max_chars" in w for w in result["warnings"])


def test_xlsx_feuilles_masquees_lignes_et_plafond(tmp_path):
    openpyxl = pytest.importorskip("openpyxl")
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Budget"
    ws.append(["Poste", "Montant"])
    ws.append(["Loyer", 870.0])
    ws.append([None, None])
    ws.append(["Total", 870.5])
    hidden = wb.create_sheet("Brouillon")
    hidden.sheet_state = "hidden"
    for i in range(10):
        hidden.append([f"ligne {i}"])
    wb.properties.creator = "Claire Martin"
    path = tmp_path / "budget.xlsx"
    wb.save(path)

    result = office.parse_xlsx_file(str(path), max_rows=4)
    assert "## Feuille « Budget »\nPoste | Montant\nLoyer | 870\nTotal | 870.5" in result["text"]
    assert "## Feuille « Brouillon » (masquée)" in result["text"]
    assert result["sheets"][1] == {"name": "Brouillon", "rows": 10, "hidden": True}
    assert any("4 lignes lues sur 10" in w for w in result["warnings"])
    assert result["metadata"]["author"] == "Claire Martin"


def test_odt_titres_paragraphes_listes_tableaux_sans_commentaires(tmp_path):
    body = (
        "<office:text>"
        '<text:h text:outline-level="1">Objet</text:h>'
        "<text:p>Bonjour<text:s text:c=\"2\"/>Claire,<text:line-break/>suite à notre appel."
        "<office:annotation><text:p>commentaire caché</text:p></office:annotation></text:p>"
        "<text:list><text:list-item><text:p>premier point</text:p></text:list-item></text:list>"
        '<table:table table:name="Tarifs"><table:table-row>'
        "<table:table-cell><text:p>Pose</text:p></table:table-cell>"
        "<table:table-cell><text:p>450 €</text:p></table:table-cell>"
        "</table:table-row></table:table>"
        "</office:text>"
    )
    path = tmp_path / "lettre.odt"
    make_odf(path, body, "application/vnd.oasis.opendocument.text")
    result = office.parse_odf_file(str(path))
    text = result["text"]
    assert text.startswith("## Objet")
    assert "Bonjour  Claire,\nsuite à notre appel." in text  # text:s c=2 : deux espaces
    assert "commentaire caché" not in text
    assert "premier point" in text
    assert "## Tableau « Tarifs »\nPose | 450 €" in text
    assert result["kind"] == "text"
    assert result["metadata"]["author"] == "Claire Martin"
    assert result["metadata"]["lastModifiedBy"] == "Paul"


def test_ods_colonnes_repetees_bornees(tmp_path):
    body = (
        '<office:spreadsheet><table:table table:name="Ventes">'
        '<table:table-row table:number-rows-repeated="3">'
        "<table:table-cell><text:p>x</text:p></table:table-cell>"
        '<table:table-cell table:number-columns-repeated="1024"/>'
        "</table:table-row>"
        '<table:table-row table:number-rows-repeated="1048000"><table:table-cell/></table:table-row>'
        "</table:table></office:spreadsheet>"
    )
    path = tmp_path / "ventes.ods"
    make_odf(path, body, "application/vnd.oasis.opendocument.spreadsheet")
    text = office.parse_odf_file(str(path))["text"]
    assert text == "## Feuille « Ventes »\nx\nx\nx"


def test_fichier_corrompu_ou_chiffre(tmp_path):
    path = tmp_path / "chiffre.pptx"
    path.write_bytes(b"\xd0\xcf\x11\xe0 pas un zip")
    with pytest.raises(ValueError, match="mot de passe"):
        office.parse_pptx_file(str(path))


def test_bombe_zip_refusee(tmp_path, monkeypatch):
    path = tmp_path / "bombe.odt"
    make_odf(path, "<office:text>" + "<text:p>a</text:p>" * 5_000 + "</office:text>", "x")
    monkeypatch.setattr(office, "MAX_MEMBER_BYTES", 10_000)
    with pytest.raises(ValueError, match="trop volumineux"):
        office.parse_odf_file(str(path))


def test_dispatch_des_trois_formats(tmp_path):
    path = tmp_path / "bilan.pptx"
    make_pptx(path)
    result = dispatch("files.parse_pptx", {"path": str(path), "maxChars": 5_000})
    assert "Bilan 2026" in result["text"]
