"""parse_pdf_file : pages lues, start_page pour la suite d'un long PDF."""

from types import SimpleNamespace

import files.pdf_parser as pdf_parser


class _Page:
    def __init__(self, n: int):
        self.n = n

    def extract_text(self) -> str:
        return f"contenu {self.n}"


def _fake_pypdf(total: int):
    class PdfReader:
        def __init__(self, _path: str):
            self.pages = [_Page(i + 1) for i in range(total)]
            self.metadata = {"/Title": "Rapport"}

    return SimpleNamespace(PdfReader=PdfReader)


def test_reads_from_the_first_page_by_default(monkeypatch):
    monkeypatch.setattr(pdf_parser, "require", lambda _m: _fake_pypdf(5))
    out = pdf_parser.parse_pdf_file("x.pdf", max_pages=2)
    assert out["firstPage"] == 1 and out["lastPage"] == 2 and out["pagesRead"] == 2
    assert out["truncated"] is True
    assert out["text"].startswith("--- Page 1 ---")
    assert "contenu 3" not in out["text"]
    assert out["metadata"]["title"] == "Rapport"


def test_start_page_reads_the_rest(monkeypatch):
    monkeypatch.setattr(pdf_parser, "require", lambda _m: _fake_pypdf(5))
    out = pdf_parser.parse_pdf_file("x.pdf", max_pages=50, start_page=4)
    assert out["firstPage"] == 4 and out["lastPage"] == 5 and out["pagesRead"] == 2
    assert out["truncated"] is False
    assert "--- Page 4 ---" in out["text"] and "contenu 5" in out["text"]
    assert "contenu 3" not in out["text"]


def test_start_page_past_the_end_reads_nothing(monkeypatch):
    monkeypatch.setattr(pdf_parser, "require", lambda _m: _fake_pypdf(3))
    out = pdf_parser.parse_pdf_file("x.pdf", start_page=9)
    assert out["pagesRead"] == 0 and out["text"] == ""
    assert out["truncated"] is False
