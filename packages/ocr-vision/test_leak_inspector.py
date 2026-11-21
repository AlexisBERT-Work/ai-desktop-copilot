"""Fichiers piégés construits à la volée : chaque fuite doit être vue, un fichier propre ne rien signaler."""

import zipfile

import pytest

from files import leak_inspector as leaks
from main import dispatch

W = leaks.NS["w"]
REL = leaks.NS["rel"]
CORE = (
    '<cp:coreProperties xmlns:cp="{cp}" xmlns:dc="{dc}">'
    "<dc:creator>Claire Martin</dc:creator><cp:lastModifiedBy>Paul Durand</cp:lastModifiedBy>"
    "<cp:revision>14</cp:revision></cp:coreProperties>"
).format(**leaks.NS)
APP = (
    '<Properties xmlns="{ep}"><Company>Cabinet Martin</Company>'
    "<Template>Normal.dotm</Template><TotalTime>312</TotalTime></Properties>"
).format(**leaks.NS)


def _whats(result):
    return {c["quoi"]: c for c in result["constats"]}


def _jpeg_with_gps(lat=(45, 45, 50.4), lon=(4, 50, 31.2)):
    Image = pytest.importorskip("PIL.Image")
    import io

    exif = Image.Exif()
    exif[0x010F] = "Canon"
    exif[0x0110] = "EOS 250D"
    exif[0x8825] = {1: "N", 2: lat, 3: "E", 4: lon}
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(buf, "JPEG", exif=exif.tobytes())
    return buf.getvalue()


def test_photo_gps_et_appareil(tmp_path):
    path = tmp_path / "plage.jpg"
    path.write_bytes(_jpeg_with_gps())
    found = _whats(leaks.inspect_file_leaks(str(path)))
    assert found["Position GPS"]["niveau"] == "élevé"
    assert found["Position GPS"]["detail"].startswith("45.76400, 4.84200")
    assert "Canon EOS 250D" in found["Appareil"]["detail"]


def test_photo_dans_un_processus_neuf(tmp_path):
    """Comme dans le sidecar : rien n'a importé `PIL.Image` avant l'inspecteur
    (les autres tests le font, ce qui a masqué un import cassé)."""
    import json
    import os
    import subprocess
    import sys

    path = tmp_path / "plage.jpg"
    path.write_bytes(_jpeg_with_gps())
    code = (
        "import json, sys\n"
        "from files.leak_inspector import inspect_file_leaks\n"
        "print(json.dumps(inspect_file_leaks(sys.argv[1])))\n"
    )
    out = subprocess.run(
        [sys.executable, "-c", code, str(path)],
        cwd=os.path.dirname(os.path.abspath(__file__)),
        capture_output=True,
        text=True,
        check=True,
    )
    assert "Position GPS" in {c["quoi"] for c in json.loads(out.stdout)["constats"]}


def test_photo_propre_ne_signale_rien(tmp_path):
    Image = pytest.importorskip("PIL.Image")
    path = tmp_path / "propre.png"
    Image.new("RGB", (8, 8)).save(path)
    result = leaks.inspect_file_leaks(str(path))
    assert result["constats"] == []
    assert result["resume"].startswith("Rien de caché")


def test_png_avec_invite_de_generation(tmp_path):
    Image = pytest.importorskip("PIL.Image")
    PngInfo = pytest.importorskip("PIL.PngImagePlugin").PngInfo
    meta = PngInfo()
    meta.add_text("parameters", "portrait of my neighbour, 4k")
    meta.add_text("Author", "Claire")
    path = tmp_path / "image.png"
    Image.new("RGB", (8, 8)).save(path, pnginfo=meta)
    found = _whats(leaks.inspect_file_leaks(str(path)))
    assert found["Invite de génération d'image"]["niveau"] == "élevé"
    assert "Author" in found["Champs texte"]["detail"]


def make_docx(path, with_leaks=True):
    body = "<w:p><w:r><w:t>Devis</w:t></w:r></w:p>"
    if with_leaks:
        body += (
            '<w:p><w:ins w:id="1" w:author="Paul Durand"><w:r><w:t>remise 30 %</w:t></w:r></w:ins>'
            '<w:del w:id="2" w:author="Claire Martin"><w:r><w:delText>prix plancher</w:delText></w:r></w:del>'
            "<w:r><w:rPr><w:vanish/></w:rPr><w:t>marge 40 %</w:t></w:r></w:p>"
        )
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("word/document.xml", f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>')
        if not with_leaks:
            return
        zf.writestr("docProps/core.xml", CORE)
        zf.writestr("docProps/app.xml", APP)
        zf.writestr(
            "word/comments.xml",
            f'<w:comments xmlns:w="{W}"><w:comment w:id="0" w:author="Paul Durand"><w:p/></w:comment>'
            f'<w:comment w:id="1" w:author="Claire Martin"><w:p/></w:comment></w:comments>',
        )
        zf.writestr(
            "word/_rels/settings.xml.rels",
            f'<Relationships xmlns="{REL}"><Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" '
            'Target="file:///C:\\Users\\cmartin\\AppData\\Roaming\\Microsoft\\Templates\\Devis.dotx" '
            'TargetMode="External"/></Relationships>',
        )
        zf.writestr("word/embeddings/Microsoft_Excel_Worksheet.xlsx", b"PK")
        zf.writestr("word/media/image1.jpeg", _jpeg_with_gps())


def test_docx_piege(tmp_path):
    path = tmp_path / "devis.docx"
    make_docx(path)
    result = leaks.inspect_file_leaks(str(path))
    found = _whats(result)
    assert found["Suivi des modifications"]["niveau"] == "élevé"
    assert "Paul Durand" in found["Suivi des modifications"]["detail"]
    assert found["Commentaires"]["detail"].startswith("2 de Paul Durand, Claire Martin")
    assert found["Texte masqué"]["detail"].startswith("1 passage")
    assert "Devis.dotx" in found["Lien vers un fichier du poste"]["detail"]
    assert "Microsoft_Excel_Worksheet.xlsx" in found["Fichiers incorporés"]["detail"]
    assert "Image incorporée image1.jpeg : Position GPS" in found
    assert found["Auteurs"]["detail"] == "Claire Martin, Paul Durand"
    assert found["Société"]["detail"] == "Cabinet Martin"
    assert found["Temps d'édition"]["detail"] == "312 minutes"
    # Les élevés d'abord, et le résumé les compte.
    levels = [c["niveau"] for c in result["constats"]]
    assert levels == sorted(levels, key=lambda l: {"élevé": 0, "moyen": 1, "info": 2}[l])
    assert "dont 6 élevé(s)" in result["resume"]


def test_docx_propre(tmp_path):
    path = tmp_path / "propre.docx"
    make_docx(path, with_leaks=False)
    assert leaks.inspect_file_leaks(str(path))["constats"] == []


def test_xlsx_feuille_masquee_et_pptx_diapo_masquee(tmp_path):
    x = leaks.NS["x"]
    xlsx = tmp_path / "budget.xlsx"
    with zipfile.ZipFile(xlsx, "w") as zf:
        zf.writestr(
            "xl/workbook.xml",
            f'<workbook xmlns="{x}"><sheets><sheet name="Budget"/>'
            '<sheet name="Salaires" state="veryHidden"/></sheets></workbook>',
        )
    assert _whats(leaks.inspect_file_leaks(str(xlsx)))["Feuilles masquées"]["detail"] == "Salaires"

    p = leaks.NS["p"]
    pptx = tmp_path / "kickoff.pptx"
    with zipfile.ZipFile(pptx, "w") as zf:
        zf.writestr("ppt/slides/slide1.xml", f'<p:sld xmlns:p="{p}"/>')
        zf.writestr("ppt/slides/slide2.xml", f'<p:sld xmlns:p="{p}" show="0"/>')
        zf.writestr("ppt/notesSlides/notesSlide1.xml", f'<p:notes xmlns:p="{p}"/>')
    found = _whats(leaks.inspect_file_leaks(str(pptx)))
    assert found["Diapos masquées"]["detail"] == "1 sur 2"
    assert found["Notes de l'orateur"]["detail"] == "sur 1 diapo(s)"


def test_odt_commentaires_et_suivi(tmp_path):
    ns = 'xmlns:office="{office}" xmlns:text="{text}" xmlns:meta="{meta}" xmlns:dc="{dc}"'.format(**leaks.NS)
    path = tmp_path / "lettre.odt"
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr(
            "meta.xml",
            f"<office:document-meta {ns}><office:meta><meta:initial-creator>Claire</meta:initial-creator>"
            "<meta:editing-cycles>9</meta:editing-cycles></office:meta></office:document-meta>",
        )
        zf.writestr(
            "content.xml",
            f"<office:document-content {ns}><office:body><office:text>"
            "<text:tracked-changes><text:changed-region><text:deletion><office:change-info>"
            "<dc:creator>Paul</dc:creator></office:change-info></text:deletion></text:changed-region>"
            "</text:tracked-changes>"
            "<text:p>x<office:annotation><dc:creator>Marc</dc:creator><text:p>à revoir</text:p>"
            "</office:annotation></text:p></office:text></office:body></office:document-content>",
        )
    found = _whats(leaks.inspect_file_leaks(str(path)))
    assert found["Commentaires"]["detail"] == "1 de Marc"
    assert found["Suivi des modifications"]["detail"].startswith("1 modification(s) de Paul")
    assert found["Auteurs"]["detail"] == "Claire"


def test_pdf_auteur_annotations_et_revision_incrementale(tmp_path):
    pypdf = pytest.importorskip("pypdf")
    from pypdf.annotations import Text

    writer = pypdf.PdfWriter()
    writer.add_blank_page(200, 200)
    writer.add_metadata({"/Author": "Claire Martin", "/Producer": "Word"})
    annot = Text(rect=(10, 10, 30, 30), text="prix à négocier")
    annot[pypdf.generic.NameObject("/T")] = pypdf.generic.TextStringObject("Paul Durand")
    writer.add_annotation(page_number=0, annotation=annot)
    path = tmp_path / "rapport.pdf"
    with open(path, "wb") as fh:
        writer.write(fh)

    found = _whats(leaks.inspect_file_leaks(str(path)))
    assert found["Auteur"]["detail"] == "Claire Martin"
    assert found["Commentaires et annotations"]["detail"] == "1 annotation(s) de Paul Durand"
    assert "Révisions incrémentales" not in found

    # Une mise à jour incrémentale empile une nouvelle version derrière l'ancienne.
    updated = pypdf.PdfWriter(str(path), incremental=True)
    updated.add_metadata({"/Title": "v2"})
    v2 = tmp_path / "rapport-v2.pdf"
    updated.write(str(v2))
    assert v2.read_bytes().startswith(path.read_bytes())  # l'ancienne version est toujours là
    assert leaks._pdf_revisions(str(v2)) == 1
    assert _whats(leaks.inspect_file_leaks(str(v2)))["Révisions incrémentales"]["niveau"] == "élevé"


def test_revisions_pdf_sections_vides_et_linearisation(tmp_path):
    body = b"%PDF-1.7\r\n1 0 obj\r\n<</Type/Catalog>>\r\nendobj\r\nstartxref\r\n9\r\n%%EOF\r\n"
    # Export Word : section vide ajoutée (référence hybride), pas une révision.
    hybrid = body + b"xref\r\n0 0\r\ntrailer\r\n<</Prev 9/XRefStm 5>>\r\nstartxref\r\n80\r\n%%EOF"
    # Linéarisé : la partie « première page » se termine par son propre %%EOF.
    linear = b"%PDF-1.7\n1 0 obj <</Linearized 1>> endobj\n%%EOF\n2 0 obj <<>> endobj\n%%EOF\n"
    # Vraie mise à jour : de nouveaux objets derrière le premier %%EOF.
    updated = body + b"3 0 obj\r\n<</Title (v2)>>\r\nendobj\r\nstartxref\r\n90\r\n%%EOF\r\n"
    for name, data, expected in (
        ("hybride", hybrid, 0),
        ("lineaire", linear, 0),
        ("lineaire-mis-a-jour", linear + b"4 0 obj <<>> endobj\n%%EOF\n", 1),
        ("mis-a-jour", updated, 1),
    ):
        path = tmp_path / f"{name}.pdf"
        path.write_bytes(data)
        assert leaks._pdf_revisions(str(path)) == expected, name


def _pdf_with_content(path, content, annots=()):
    """Une page Helvetica dont on écrit le flux à la main (ordre de peinture maîtrisé)."""
    pypdf = pytest.importorskip("pypdf")
    from pypdf.generic import ArrayObject, DecodedStreamObject, DictionaryObject, NameObject

    writer = pypdf.PdfWriter()
    page = writer.add_blank_page(300, 300)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
    )
    stream = DecodedStreamObject()
    stream.set_data(content.encode("latin-1"))
    page[NameObject("/Contents")] = writer._add_object(stream)
    if annots:
        page[NameObject("/Annots")] = ArrayObject(writer._add_object(a) for a in annots)
    with open(path, "wb") as fh:
        writer.write(fh)


def test_pdf_texte_sous_un_rectangle_noir(tmp_path):
    caviarde = tmp_path / "caviarde.pdf"
    # Le texte d'abord, le rectangle noir par-dessus : le caviardage raté type.
    _pdf_with_content(caviarde, "BT /F1 12 Tf 50 200 Td (IBAN FR76 1234) Tj ET 0 g 45 195 150 20 re f")
    found = _whats(leaks.inspect_file_leaks(str(caviarde)))
    assert found["Texte sous un rectangle noir"]["niveau"] == "élevé"
    assert found["Texte sous un rectangle noir"]["detail"].startswith("1 ligne(s) recouverte(s), page(s) 1 :")

    # Surligneur noir sous un texte noir : invisible aussi.
    surligne = tmp_path / "surligne.pdf"
    _pdf_with_content(surligne, "0 g 45 195 150 20 re f BT /F1 12 Tf 50 200 Td (secret) Tj ET")
    assert "Texte sous un rectangle noir" in _whats(leaks.inspect_file_leaks(str(surligne)))

    # En-tête de tableau : texte blanc sur fond noir, lisible. Rien à signaler.
    entete = tmp_path / "entete.pdf"
    _pdf_with_content(entete, "0 g 45 195 150 20 re f 1 g BT /F1 12 Tf 50 200 Td (Total) Tj ET")
    assert "Texte sous un rectangle noir" not in _whats(leaks.inspect_file_leaks(str(entete)))

    # Rectangle noir ailleurs sur la page : le texte reste visible.
    a_cote = tmp_path / "a-cote.pdf"
    _pdf_with_content(a_cote, "BT /F1 12 Tf 50 200 Td (Bonjour) Tj ET 0 g 45 20 150 20 re f")
    assert "Texte sous un rectangle noir" not in _whats(leaks.inspect_file_leaks(str(a_cote)))


def test_pdf_caviardage_en_annotation(tmp_path):
    pytest.importorskip("pypdf")
    from pypdf.generic import ArrayObject, DictionaryObject, FloatObject, NameObject

    def annot(subtype, **extra):
        d = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Annot"),
                NameObject("/Subtype"): NameObject(subtype),
                NameObject("/Rect"): ArrayObject(FloatObject(v) for v in (45, 195, 195, 215)),
            }
        )
        d.update({NameObject(k): v for k, v in extra.items()})
        return d

    black = ArrayObject(FloatObject(0) for _ in range(3))
    path = tmp_path / "annote.pdf"
    _pdf_with_content(
        path,
        "BT /F1 12 Tf 50 200 Td (salaire 4 200) Tj ET",
        annots=[annot("/Redact"), annot("/Square", **{"/IC": black}), annot("/Link")],
    )
    found = _whats(leaks.inspect_file_leaks(str(path)))
    assert found["Caviardage réversible"]["detail"].startswith("2 zone(s)")


def test_format_refuse_et_fichier_chiffre(tmp_path):
    txt = tmp_path / "notes.txt"
    txt.write_text("x")
    with pytest.raises(ValueError, match="Format non inspecté"):
        leaks.inspect_file_leaks(str(txt))
    enc = tmp_path / "chiffre.docx"
    enc.write_bytes(b"\xd0\xcf\x11\xe0 pas un zip")
    with pytest.raises(ValueError, match="mot de passe"):
        leaks.inspect_file_leaks(str(enc))


def test_dispatch(tmp_path):
    path = tmp_path / "devis.docx"
    make_docx(path)
    assert dispatch("files.inspect_leaks", {"path": str(path)})["format"] == "docx"
