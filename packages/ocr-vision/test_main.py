"""Tests du dispatcher JSON-RPC (chemins purs, sans dépendances lourdes —
les imports paresseux de main.py ne chargent ni tesseract ni pandas ici)."""

import main


def test_health_check():
    result = main.dispatch("health.check", {})
    assert result["status"] == "ok"
    assert isinstance(result["pid"], int)


def test_handle_request_wraps_result():
    response = main.handle_request({"id": "a1", "method": "health.check", "params": {}})
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == "a1"
    assert response["result"]["status"] == "ok"
    assert "error" not in response


def test_unknown_method_becomes_jsonrpc_error():
    response = main.handle_request({"id": 7, "method": "nope.nope", "params": {}})
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == 7
    assert response["error"]["code"] == -32603
    assert "Unknown method" in response["error"]["message"]


def test_jsonrpc_protocol_preserves_accents():
    """Aller-retour du texte accentué sur le protocole JSON-RPC réel.

    Contexte (régression 2026-08-16) : Node envoie du JSON UTF-8 brut sur stdin
    (JSON.stringify n'échappe pas le non-ASCII). Si Python relit ce flux avec
    l'encodage local de Windows (cp1252), « août » arrive en « aoÃ»t » et les
    digests de presse française partent au LLM en charabia. Le défaut est resté
    invisible tant que le protocole ne transportait que des chemins de fichiers
    et du base64 ; `web.extract_article` a été la première méthode à faire
    passer du texte d'article. Corrigé par le `reconfigure(utf-8)` de main.py.

    PORTÉE EXACTE DE CE TEST — à lire avant de s'y fier. Il vérifie l'aller-retour
    de bout en bout, mais il **ne reproduit pas** la panne cp1252 : mesuré, il
    passe aussi correctif retiré. En cause, trafilatura répare parfois le
    mojibake par détection de charset, et cette détection dépend du contenu —
    elle réussit sur cet échantillon et échoue sur d'autres. La nécessité du
    correctif a donc été prouvée ailleurs, sur le vrai chemin Node → sidecar
    (codepoints U+00C3 U+00BB au lieu de U+00FB, avec et sans correctif).
    Ne pas retirer le `reconfigure` de main.py en se fiant au vert d'ici.
    """
    import json
    import subprocess
    import sys
    from pathlib import Path

    here = Path(__file__).parent
    html = (
        "<html><body><article><p>"
        "La réforme du 1er août 2026 coûte très cher aux Français : près de "
        "4,2 milliards d'euros selon l'étude publiée mercredi, un déséquilibre "
        "budgétaire inédit qui inquiète les économistes du pays tout entier."
        "</p></article></body></html>"
    )
    request = json.dumps(
        {"jsonrpc": "2.0", "id": "1", "method": "web.extract_article",
         "params": {"html": html}}
    )

    # PYTHONUTF8=0 force le mode « encodage local » (cp1252 sous Windows) :
    # c'est la configuration sous laquelle le bug se produit. Sans ce forçage,
    # l'enfant hérite parfois d'un locale déjà UTF-8 et le test passe même
    # correctif retiré — vérifié : il ne protégeait alors rien du tout.
    import os

    env = {**os.environ, "PYTHONUTF8": "0"}
    env.pop("PYTHONIOENCODING", None)

    proc = subprocess.run(
        [sys.executable, str(here / "main.py")],
        input=(request + "\n").encode("utf-8"),  # octets bruts, comme Node
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env=env,
        timeout=120,
    )
    payload = json.loads(proc.stdout.decode("utf-8").strip().splitlines()[0])
    assert "error" not in payload, payload
    text = payload["result"]["text"]
    assert "août" in text
    assert "réforme" in text
    assert "aoÃ»t" not in text


def test_extract_article_roundtrips_accents():
    """Le texte accentué doit ressortir intact de l'extraction."""
    html = (
        "<html><body><article><p>"
        "La réforme du 1er août 2026 coûte très cher aux Français : près de "
        "4,2 milliards d'euros selon l'étude publiée mercredi, un déséquilibre "
        "budgétaire inédit qui inquiète les économistes du pays tout entier."
        "</p></article></body></html>"
    )
    result = main.dispatch("web.extract_article", {"html": html})
    assert "août" in result["text"]
    assert "aoÃ»t" not in result["text"]
    assert result["method"] == "trafilatura"
