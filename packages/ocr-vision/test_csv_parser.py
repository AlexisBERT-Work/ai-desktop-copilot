"""parse_csv_file : en-têtes, lignes, plafond max_rows, aperçu texte."""

from pathlib import Path

from files.csv_parser import parse_csv_file


def test_parse_csv_basic(tmp_path: Path):
    p = tmp_path / "data.csv"
    p.write_text("nom,ville\nAlice,Paris\nBob,Lyon\n", encoding="utf-8")
    out = parse_csv_file(str(p))
    assert out["headers"] == ["nom", "ville"]
    assert out["rowCount"] == 2
    assert out["rows"][0] == {"nom": "Alice", "ville": "Paris"}
    assert out["truncated"] is False
    assert "Alice,Paris" in out["text"]


def test_parse_csv_respects_max_rows(tmp_path: Path):
    p = tmp_path / "big.csv"
    p.write_text("\n".join(["n"] + [str(i) for i in range(10)]), encoding="utf-8")
    out = parse_csv_file(str(p), max_rows=3)
    assert out["rowCount"] == 3
    assert out["truncated"] is True
